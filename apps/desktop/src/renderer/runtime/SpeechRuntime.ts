import {
  type EmotionTextSegment,
  parseEmotionalReply,
  stripAssistantMarkup,
} from '../../shared/emotion'
import type {
  CharacterActivityState,
  CharacterConversationPresenceState,
  CharacterRuntimeMode,
  CharacterSpeechState,
  CharacterState,
} from '../../shared/runtime/character-state'
import type { EventBus, RuntimeEventType } from '../../shared/runtime/events'
import { hasSpeakableContent } from '../../shared/speech/speakable-content'
import type { MouthWeights } from '../avatar/embodiment/speech/LipSync'
import type { CharacterStateStore } from './ShioRuntime'
import { speechErrorFromResponse } from './speechCapabilities'

export type SpeechRuntimeStatus =
  | 'idle'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'synthesizing'
  | 'speaking'
type SpeechReply = Awaited<ReturnType<Window['api']['tts']['synthesizeReply']>>
export type SuccessfulSpeechReply = SpeechReply & { ok: true; audioBuffer: ArrayBuffer }

interface SpeechStateTransition {
  status: SpeechRuntimeStatus
  mode: CharacterRuntimeMode
  emotion?: string
  vrmEmotion?: string
  currentSentence?: string
  voiceId?: string
  conversationPresence?: CharacterConversationPresenceState
}

interface AvatarStateMirror {
  loaded?: boolean
  lipsync?: MouthWeights
}

export interface SpeechStateTimelineEntry {
  at: number
  from: CharacterSpeechState
  to: CharacterSpeechState
  mode: CharacterRuntimeMode
  durationMs: number | null
  emotion: string
}

export interface AssistantReplyDraft {
  replyText: string
  displayText: string
  speechText: string
  emotionKey: string
  segments: EmotionTextSegment[]
}

export { hasSpeakableContent }

export interface AssistantSpeechTurn extends AssistantReplyDraft {
  speech: SuccessfulSpeechReply
  ttsLatencyText: string | null
}

export interface DebugSpeechTurn {
  text: string
  emotionKey: string
  speech: SuccessfulSpeechReply
  ttsLatencyText: string | null
}

export interface RecognizedSpeech {
  text: string
}

export class SpeechRuntime {
  private speechTimeline: SpeechStateTimelineEntry[] = []
  private lastSpeechTransitionAt: number | null = null

  constructor(
    private readonly characterState: CharacterStateStore,
    private readonly events: EventBus,
  ) {}

  transitionSpeechState(transition: SpeechStateTransition): CharacterState {
    const previous = this.characterState.get()
    const nextSpeech = this.toSpeechState(transition.status)
    const next = this.characterState.update((current) => {
      const emotion = transition.emotion ?? current.emotion
      return {
        ...current,
        mode: transition.mode,
        emotion,
        attention: this.toAttention(transition.status),
        speechState: {
          ...current.speechState,
          status: nextSpeech,
          voiceId: transition.voiceId ?? current.voice.voiceId,
          isSpeaking: nextSpeech === 'speaking',
          ttsGeneration: this.toTtsGeneration(transition.status),
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
        activity: this.toActivity(transition.status),
        avatar: {
          ...current.avatar,
          mode: transition.mode,
          expression: emotion,
          vrmExpression: transition.vrmEmotion,
        },
        updatedAt: Date.now(),
      }
    })
    if (previous.mode !== next.mode) {
      this.publishCharacterEvent('ModeChanged', next.mode)
    }
    if (previous.emotion !== next.emotion) {
      this.publishCharacterEvent('EmotionChanged', next.emotion)
    }
    this.recordSpeechTimeline(
      previous.speechState.status,
      nextSpeech,
      transition.mode,
      next.emotion,
    )
    return next
  }

  mirrorAvatarState(mirror: AvatarStateMirror): CharacterState {
    return this.characterState.update((current) => ({
      ...current,
      avatar: {
        ...current.avatar,
        loaded: mirror.loaded ?? current.avatar.loaded,
        lipsync: mirror.lipsync ?? current.avatar.lipsync,
      },
      updatedAt: Date.now(),
    }))
  }

  updateConversationPresence(
    conversationPresence: CharacterConversationPresenceState,
  ): CharacterState {
    return this.characterState.update((current) => ({
      ...current,
      conversationPresence,
      updatedAt: Date.now(),
    }))
  }

  updateSpeechPlaybackProgress(progress: number): CharacterState {
    const playbackProgress = Math.max(0, Math.min(1, progress))
    return this.characterState.update((current) => ({
      ...current,
      speechState: {
        ...current.speechState,
        playbackProgress,
      },
      updatedAt: Date.now(),
    }))
  }

  getCharacterState(): CharacterState {
    return this.characterState.get()
  }

  getSpeechTimeline(): SpeechStateTimelineEntry[] {
    return [...this.speechTimeline]
  }

  async createAssistantReply(
    turnId: string,
    userText: string,
    screenContextId?: string,
  ): Promise<AssistantReplyDraft> {
    const reply = await window.api.llm.reply(turnId, userText, screenContextId)
    if (!reply.ok || !reply.replyText) {
      if (reply.errorCode) throw new Error(`SCREEN_CONTEXT_ERROR:${reply.errorCode}`)
      throw new Error(reply.error ?? 'Нет ответа')
    }

    const parsed = parseEmotionalReply(reply.replyText)
    const emotionKey = parsed.primaryEmotion
    const displayText = parsed.visibleText
    const segments = parsed.segments.map((segment) => ({
      ...segment,
      text: this.speechText(segment.text),
    }))
    const speechText = segments.map((segment) => segment.text).join(' ')
    return { replyText: reply.replyText, displayText, speechText, emotionKey, segments }
  }

  async synthesizeAssistantReply(
    turnId: string,
    draft: AssistantReplyDraft,
  ): Promise<AssistantSpeechTurn> {
    const speech = await window.api.tts.synthesizeReply(turnId, draft.speechText, draft.emotionKey)
    if (!speech.ok || !speech.audioBuffer) {
      if (speech.errorCode) throw speechErrorFromResponse('synthesis', speech)
      throw new Error(speech.error ?? 'Нет аудио')
    }
    const successfulSpeech = speech as SuccessfulSpeechReply

    return {
      ...draft,
      speech: successfulSpeech,
      ttsLatencyText: this.formatTtsLatency(successfulSpeech),
    }
  }

  async synthesizeSegment(
    turnId: string,
    segment: EmotionTextSegment,
  ): Promise<SuccessfulSpeechReply> {
    const speech = await window.api.tts.synthesizeReply(turnId, segment.text, segment.emotion)
    if (!speech.ok || !speech.audioBuffer) {
      if (speech.errorCode) throw speechErrorFromResponse('synthesis', speech)
      throw new Error(speech.error ?? 'No audio')
    }
    return speech as SuccessfulSpeechReply
  }

  hasSpeakableContent(text: string): boolean {
    return hasSpeakableContent(text)
  }

  async createDebugSpeechTurn(turnId: string, emotionKey = 'happy'): Promise<DebugSpeechTurn> {
    const text = `[${emotionKey}] Тестирую полный цикл Shio.`
    const speech = await window.api.tts.synthesizeReply(turnId, text, emotionKey)
    if (!speech.ok || !speech.audioBuffer) {
      if (speech.errorCode) throw speechErrorFromResponse('synthesis', speech)
      throw new Error(speech.error ?? 'нет аудио')
    }
    const successfulSpeech = speech as SuccessfulSpeechReply

    return {
      text,
      emotionKey,
      speech: successfulSpeech,
      ttsLatencyText: this.formatTtsLatency(successfulSpeech),
    }
  }

  async recognizeSpeech(wavBuffer: ArrayBuffer): Promise<RecognizedSpeech> {
    const res = await window.api.asr.recognize(wavBuffer)
    if (!res.ok || !res.text) {
      if (res.errorCode) throw speechErrorFromResponse('recognition', res)
      throw new Error(res.error ?? 'No text')
    }

    return { text: res.text }
  }

  private toSpeechState(status: SpeechRuntimeStatus): CharacterSpeechState {
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

  private toActivity(status: SpeechRuntimeStatus): CharacterActivityState {
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

  private toAttention(status: SpeechRuntimeStatus): CharacterState['attention'] {
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

  private toTtsGeneration(
    status: SpeechRuntimeStatus,
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

  private speechText(text: string): string {
    return stripAssistantMarkup(text)
  }

  private formatTtsLatency(speech: SpeechReply): string | null {
    const value = Number(speech.latencyMs)
    if (!Number.isFinite(value) || value < 0) return null

    const cacheState = (speech.cache ?? '').toUpperCase()
    if (cacheState === 'HIT') {
      const generated = Number(speech.generatedLatencyMs)
      const generatedText =
        Number.isFinite(generated) && generated > 0
          ? `, генерация была ${Math.round(generated)} мс`
          : ''
      return `TTS: ${Math.round(value)} мс (кэш${generatedText})`
    }
    if (cacheState === 'MISS') return `TTS: ${Math.round(value)} мс (miss)`
    if (cacheState === 'SKIP') return `TTS: ${Math.round(value)} мс (без кэша)`
    return `TTS: ${Math.round(value)} мс`
  }

  private publishCharacterEvent(type: RuntimeEventType, detail: string): void {
    this.events.publish({
      type,
      category: 'character',
      source: 'renderer.speechRuntime',
      detail,
    })
  }

  private recordSpeechTimeline(
    from: CharacterSpeechState,
    to: CharacterSpeechState,
    mode: CharacterRuntimeMode,
    emotion: string,
  ): void {
    if (from === to) return
    const at = Date.now()
    const entry: SpeechStateTimelineEntry = {
      at,
      from,
      to,
      mode,
      durationMs: this.lastSpeechTransitionAt === null ? null : at - this.lastSpeechTransitionAt,
      emotion,
    }
    this.lastSpeechTransitionAt = at
    this.speechTimeline = [...this.speechTimeline, entry].slice(-40)
    console.log(
      `[SPEECHSTATE] ${from}->${to} mode=${mode} emotion=${emotion} durationMs=${entry.durationMs ?? 'n/a'}`,
    )
  }
}
