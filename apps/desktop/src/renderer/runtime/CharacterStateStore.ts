import type {
  CharacterActivityState,
  CharacterConversationPresenceState,
  CharacterRuntimeMode,
  CharacterSpeechState,
  CharacterState,
  EventBus,
} from '../../shared/runtime'
import {
  cloneCharacterState,
  INITIAL_CHARACTER_STATE,
  normalizeCharacterState,
} from '../../shared/runtime'

export type CharacterLifecycleStatus =
  | 'idle'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'synthesizing'
  | 'speaking'

export interface CharacterLifecycleTransition {
  status: CharacterLifecycleStatus
  mode: CharacterRuntimeMode
  emotion?: string
  vrmEmotion?: string
  currentSentence?: string
  voiceId?: string
  conversationPresence?: CharacterConversationPresenceState
}

export interface AvatarCharacterStateProjection {
  avatar: Partial<Pick<CharacterState['avatar'], 'loaded' | 'lipsync'>>
  animation: CharacterState['animation']
  posture: CharacterState['posture']
  behaviorReplyType?: string
}

export interface CharacterStateReader {
  get(): CharacterState
}

export interface ConversationStateWriter {
  transition(transition: CharacterLifecycleTransition): CharacterState
  setPresence(presence: CharacterConversationPresenceState): CharacterState
}

export interface SpeechStateWriter {
  transitionInput(
    status: 'idle' | 'listening' | 'recognizing',
    mode: CharacterRuntimeMode,
  ): CharacterState
  setPlaybackProgress(progress: number): CharacterState
}

export interface AdmissionStateWriter {
  setAttention(attention: CharacterState['attention']): CharacterState
}

export interface AvatarStateWriter {
  sync(projection: AvatarCharacterStateProjection): CharacterState
}

type CharacterStateListener = (previous: CharacterState, current: CharacterState) => void

function toSpeechState(status: CharacterLifecycleStatus): CharacterSpeechState {
  switch (status) {
    case 'listening':
      return 'listening'
    case 'recognizing':
      return 'recognizing'
    case 'thinking':
      return 'generating'
    case 'synthesizing':
      return 'synthesizing'
    case 'speaking':
      return 'speaking'
    default:
      return 'silent'
  }
}

function toActivity(status: CharacterLifecycleStatus): CharacterActivityState {
  switch (status) {
    case 'listening':
      return 'listening'
    case 'recognizing':
    case 'thinking':
      return 'processing'
    case 'synthesizing':
      return 'preparingSpeech'
    case 'speaking':
      return 'speaking'
    default:
      return 'waiting'
  }
}

function toAttention(status: CharacterLifecycleStatus): CharacterState['attention'] {
  switch (status) {
    case 'listening':
      return { focus: 'user', confidence: 0.9 }
    case 'recognizing':
      return { focus: 'speechService', confidence: 0.8 }
    case 'thinking':
      return { focus: 'llm', confidence: 0.7 }
    case 'synthesizing':
      return { focus: 'tts', confidence: 0.8 }
    case 'speaking':
      return { focus: 'avatar', confidence: 0.9 }
    default:
      return { focus: 'none', confidence: 0 }
  }
}

function toTtsGeneration(
  status: CharacterLifecycleStatus,
): CharacterState['speechState']['ttsGeneration'] {
  switch (status) {
    case 'synthesizing':
      return 'generating'
    case 'speaking':
      return 'ready'
    case 'idle':
      return 'idle'
    default:
      return 'requested'
  }
}

export class CharacterStateStore implements CharacterStateReader {
  private state: CharacterState = cloneCharacterState(INITIAL_CHARACTER_STATE)
  private readonly listeners = new Set<CharacterStateListener>()

  readonly conversation: ConversationStateWriter = Object.freeze({
    transition: (transition: CharacterLifecycleTransition) =>
      this.transitionConversation(transition),
    setPresence: (presence: CharacterConversationPresenceState) =>
      this.setConversationPresence(presence),
  })

  readonly speech: SpeechStateWriter = Object.freeze({
    transitionInput: (status: 'idle' | 'listening' | 'recognizing', mode: CharacterRuntimeMode) =>
      this.transitionSpeechInput(status, mode),
    setPlaybackProgress: (progress: number) => this.setSpeechPlaybackProgress(progress),
  })

  readonly admission: AdmissionStateWriter = Object.freeze({
    setAttention: (attention: CharacterState['attention']) => this.setAdmissionAttention(attention),
  })

  readonly avatar: AvatarStateWriter = Object.freeze({
    sync: (projection: AvatarCharacterStateProjection) => this.syncAvatar(projection),
  })

  constructor(private readonly events: EventBus) {}

  get(): CharacterState {
    return cloneCharacterState(this.state)
  }

  subscribe(listener: CharacterStateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private commit(updater: (current: CharacterState) => CharacterState): CharacterState {
    const previous = cloneCharacterState(this.state)
    this.state = normalizeCharacterState(updater(previous))
    const current = cloneCharacterState(this.state)
    for (const listener of this.listeners) listener(previous, current)
    if (previous.mode !== current.mode) {
      this.events.publish({
        type: 'ModeChanged',
        category: 'character',
        source: 'renderer.characterState',
        detail: current.mode,
      })
    }
    if (previous.emotion !== current.emotion) {
      this.events.publish({
        type: 'EmotionChanged',
        category: 'character',
        source: 'renderer.characterState',
        detail: current.emotion,
      })
    }
    return current
  }

  private transitionConversation(transition: CharacterLifecycleTransition): CharacterState {
    const nextSpeech = toSpeechState(transition.status)
    return this.commit((current) => {
      const emotion = transition.emotion ?? current.emotion
      return {
        ...current,
        mode: transition.mode,
        emotion,
        attention: toAttention(transition.status),
        speechState: {
          ...current.speechState,
          status: nextSpeech,
          voiceId: transition.voiceId ?? current.voice.voiceId,
          isSpeaking: nextSpeech === 'speaking',
          ttsGeneration: toTtsGeneration(transition.status),
          currentSentence:
            transition.currentSentence ??
            (nextSpeech === 'silent' ? '' : current.speechState.currentSentence),
          playbackProgress: nextSpeech === 'speaking' ? current.speechState.playbackProgress : 0,
        },
        voice: {
          ...current.voice,
          voiceId: transition.voiceId ?? current.voice.voiceId,
        },
        conversationPresence: transition.conversationPresence ?? current.conversationPresence,
        conversation: {
          ...current.conversation,
          conversationPhase:
            nextSpeech === 'speaking'
              ? 'replying'
              : transition.mode === 'thinking' || transition.mode === 'awaitingSpeech'
                ? 'thinking'
                : current.conversation.conversationPhase,
        },
        activity: toActivity(transition.status),
        avatar: {
          ...current.avatar,
          mode: transition.mode,
          expression: emotion,
          vrmExpression: transition.vrmEmotion,
        },
        updatedAt: Date.now(),
      }
    })
  }

  private setConversationPresence(
    conversationPresence: CharacterConversationPresenceState,
  ): CharacterState {
    return this.commit((current) => ({
      ...current,
      conversationPresence,
      updatedAt: Date.now(),
    }))
  }

  private transitionSpeechInput(
    status: 'idle' | 'listening' | 'recognizing',
    mode: CharacterRuntimeMode,
  ): CharacterState {
    const nextSpeech = toSpeechState(status)
    return this.commit((current) => ({
      ...current,
      mode,
      attention: toAttention(status),
      speechState: {
        ...current.speechState,
        status: nextSpeech,
        isSpeaking: false,
        ttsGeneration: toTtsGeneration(status),
        currentSentence: nextSpeech === 'silent' ? '' : current.speechState.currentSentence,
        playbackProgress: 0,
      },
      activity: toActivity(status),
      avatar: { ...current.avatar, mode },
      updatedAt: Date.now(),
    }))
  }

  private setSpeechPlaybackProgress(progress: number): CharacterState {
    const playbackProgress = Math.max(0, Math.min(1, progress))
    return this.commit((current) => ({
      ...current,
      speechState: { ...current.speechState, playbackProgress },
      updatedAt: Date.now(),
    }))
  }

  private setAdmissionAttention(attention: CharacterState['attention']): CharacterState {
    return this.commit((current) => ({ ...current, attention, updatedAt: Date.now() }))
  }

  private syncAvatar(projection: AvatarCharacterStateProjection): CharacterState {
    return this.commit((current) => ({
      ...current,
      animation: { ...projection.animation },
      posture: projection.posture,
      conversation: projection.behaviorReplyType
        ? { ...current.conversation, replyType: projection.behaviorReplyType }
        : current.conversation,
      avatar: {
        ...current.avatar,
        loaded: projection.avatar.loaded ?? current.avatar.loaded,
        lipsync: projection.avatar.lipsync ?? current.avatar.lipsync,
      },
      updatedAt: Date.now(),
    }))
  }
}
