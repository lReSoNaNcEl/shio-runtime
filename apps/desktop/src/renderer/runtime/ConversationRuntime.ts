import type {
  CharacterConversationPresenceState,
  CharacterRuntimeMode,
  CharacterState
} from '../../shared/runtime/characterState'
import type { EventBus, RuntimeEventCategory, RuntimeEventType } from '../../shared/runtime/events'
import type { ChatMsg } from '../Controller'
import type { PlaybackSession, AudioPlayer } from '../audio/audioPlayer'
import type {
  AdmittedConversationTurn,
  ConversationCompletionResult,
  ConversationExecutionPhase
} from '../continuousListening/types'
import type { AvatarMode, AvatarRuntime } from './AvatarRuntime'
import type { OverlayRuntime, SyncedAvatarState } from './OverlayRuntime'
import type { SpeechRuntime } from './SpeechRuntime'
import type { ConversationPresenceRuntime } from './ConversationPresenceRuntime'

export type ConversationStatus = 'idle' | 'listening' | 'recognizing' | 'thinking' | 'synthesizing' | 'speaking'
type SpeechReply = Awaited<ReturnType<Window['api']['tts']['synthesizeReply']>>
type SuccessfulSpeechReply = SpeechReply & { ok: true; audioBuffer: ArrayBuffer }

export interface ConversationRuntimeDeps {
  speechRuntime: SpeechRuntime
  conversationPresenceRuntime: ConversationPresenceRuntime
  avatarRuntime: AvatarRuntime
  overlayRuntime: OverlayRuntime
  events: EventBus
  player: AudioPlayer
  setStatus: (status: ConversationStatus) => void
  pushMessage: (role: ChatMsg['role'], text: string) => void
  markAssistantMessageInterrupted: () => void
  setResponseInterruptionPending: (pending: boolean) => void
  recordRuntimeEvent: (label: string, detail?: string) => void
  updateCharacterState: (patch: {
    status: ConversationStatus
    mode: CharacterRuntimeMode
    emotion: string
    vrmEmotion?: string
    avatar?: ReturnType<AvatarRuntime['getMirrorState']>
    conversationPresence?: CharacterConversationPresenceState
  }) => CharacterState
  rememberSpeechMetadata: (speech: SpeechReply) => void
  updateSpeechPlaybackProgress: (progress: number) => void
  isContinuousCaptureAlive: () => boolean
}

export class ConversationRuntime {
  private activeTurnId: string | null = null
  private generationTurnId: string | null = null
  private synthesisTurnId: string | null = null
  private playbackTurnId: string | null = null
  private interruption: { turnId: string; promise: Promise<never>; reject: (error: Error) => void } | null = null

  constructor(private readonly deps: ConversationRuntimeDeps) {}

  async execute(
    turn: AdmittedConversationTurn,
    reportPhase: (phase: ConversationExecutionPhase) => void
  ): Promise<ConversationCompletionResult> {
    if (this.activeTurnId) {
      return {
        status: 'failed', turnId: turn.turnId, phase: 'generation',
        error: `Conversation Runtime overlap: activeTurnId=${this.activeTurnId} requestedTurnId=${turn.turnId}`
      }
    }
    this.activeTurnId = turn.turnId
    let reject!: (error: Error) => void
    const promise = new Promise<never>((_, fail) => { reject = fail })
    this.interruption = { turnId: turn.turnId, promise, reject }
    console.debug(`[conversation] turnId=${turn.turnId} source=${turn.source} cycleId=${turn.admissionCycleId} started`)
    try {
      return turn.source === 'debug'
        ? await this.executeDebug(turn, reportPhase)
        : await this.executeConversation(turn, reportPhase)
    } finally {
      if (this.activeTurnId === turn.turnId) this.activeTurnId = null
      if (this.interruption?.turnId === turn.turnId) {
        this.interruption = null
        this.deps.setResponseInterruptionPending(false)
      }
    }
  }

  async interruptCurrentResponse(source: 'manual-stop' | 'voice-barge-in'): Promise<boolean> {
    const turnId = this.activeTurnId
    const interruption = this.interruption
    if (!turnId || !interruption || interruption.turnId !== turnId) return false
    this.deps.setResponseInterruptionPending(true)
    this.activeTurnId = null
    this.deps.player.stopCurrent(turnId, 'conversation-interrupted')
    this.deps.avatarRuntime.stopLipSync(turnId)
    this.deps.markAssistantMessageInterrupted()
    await Promise.allSettled([window.api.llm.cancelReply(turnId), window.api.tts.cancelSynthesis(turnId)])
    const listening = this.deps.isContinuousCaptureAlive()
    const status: ConversationStatus = listening ? 'listening' : 'idle'
    const mode: CharacterRuntimeMode = listening ? 'listening' : 'idle'
    const waiting = this.deps.conversationPresenceRuntime.update({ phase: 'waiting' })
    this.deps.speechRuntime.updateConversationPresence(waiting)
    this.deps.updateCharacterState({ status, mode, emotion: 'neutral', conversationPresence: waiting })
    this.applyAvatarCharacterState({ stopLipSyncTurnId: turnId })
    this.publishAvatarState({ mode, emotionKey: 'neutral' })
    this.deps.updateSpeechPlaybackProgress(0)
    this.deps.setStatus(status)
    this.deps.recordRuntimeEvent('Conversation Interrupted', `turnId=${turnId} source=${source}`)
    interruption.reject(new Error(`Conversation interrupted turnId=${turnId}`))
    return true
  }

  private async executeConversation(
    turn: AdmittedConversationTurn,
    reportPhase: (phase: ConversationExecutionPhase) => void
  ): Promise<ConversationCompletionResult> {
    let failurePhase: 'generation' | 'synthesis' | 'playback' | 'cleanup' = 'generation'
    try {
      const thinkingPresence = this.deps.conversationPresenceRuntime.update({ phase: 'thinking', userText: turn.text })
      this.enterAvatarMode('thinking', 'calm', 'thinking')
      this.deps.speechRuntime.updateConversationPresence(thinkingPresence)
      this.deps.recordRuntimeEvent('Thinking', `turnId=${turn.turnId}`)
      reportPhase('generating')
      const draft = await this.runGeneration(turn.turnId, () => this.deps.speechRuntime.createAssistantReply(turn.turnId, turn.text))
      if (!this.isCurrentTurn(turn.turnId)) return { status: 'cancelled', turnId: turn.turnId }

      this.publishRuntimeEvent('SentenceGenerated', 'speech', `turnId=${turn.turnId}`)
      const generatedPresence = this.deps.conversationPresenceRuntime.update({
        phase: 'preparingReply', userText: turn.text, replyText: draft.displayText, emotionKey: draft.emotionKey
      })
      this.deps.speechRuntime.updateConversationPresence(generatedPresence)
      this.deps.pushMessage('assistant', draft.displayText)

      if (!this.deps.speechRuntime.hasSpeakableContent(draft.speechText)) {
        reportPhase('cleaning_up')
        this.completeSilentReply(turn.turnId, draft.emotionKey, draft.displayText)
        return { status: 'completed', turnId: turn.turnId, playbackCompleted: false, cleanupCompleted: true }
      }

      this.prepareSpeech(draft.emotionKey, `turnId=${turn.turnId}`, draft.displayText)

      failurePhase = 'synthesis'
      reportPhase('synthesizing')
      failurePhase = 'playback'
      reportPhase('playing')
      this.playbackTurnId = turn.turnId
      this.deps.recordRuntimeEvent('Emotion Segments Parsed', draft.segments.map((segment) => segment.emotion).join(' → '))
      for (const segment of draft.segments) {
        if (!this.isCurrentTurn(turn.turnId)) return { status: 'cancelled', turnId: turn.turnId }
        failurePhase = 'synthesis'
        reportPhase('synthesizing')
        const speech = await this.runSynthesis(turn.turnId, () => this.deps.speechRuntime.synthesizeSegment(turn.turnId, segment))
        this.rememberSpeech(speech, null)
        failurePhase = 'playback'
        reportPhase('playing')
        await Promise.race([this.deps.player.play(speech.audioBuffer, {
          turnId: turn.turnId,
          onReady: (session) => {
            if (!this.isCurrentTurn(turn.turnId)) throw new Error(`Stale playback ready turnId=${turn.turnId}`)
            this.startSpeech(session, speech, segment.emotion, segment.text)
          },
          onProgress: (progress) => { if (this.isCurrentTurn(turn.turnId)) this.deps.updateSpeechPlaybackProgress(progress) }
        }), this.interruptionFor(turn.turnId)])
      }
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null
      if (!this.isCurrentTurn(turn.turnId)) return { status: 'cancelled', turnId: turn.turnId }

      failurePhase = 'cleanup'
      reportPhase('cleaning_up')
      await this.finishSpeechCleanup(turn.turnId)
      console.debug(`[conversation] turnId=${turn.turnId} cleanup=completed`)
      return { status: 'completed', turnId: turn.turnId, playbackCompleted: true, cleanupCompleted: true }
    } catch (error) {
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes(`Conversation interrupted turnId=${turn.turnId}`)) {
        return { status: 'cancelled', turnId: turn.turnId }
      }
      const invariantViolation = /(?:Character generation|Generation|TTS synthesis|Synthesis|Conversation Runtime|Conversation execution|Parallel playback) overlap|Parallel playback rejected/i.test(message)
      this.deps.recordRuntimeEvent(
        invariantViolation ? 'conversation.invariant_violation' : `${failurePhase} Error`,
        `turnId=${turn.turnId} phase=${failurePhase} ${message}`
      )
      // Internal concurrency diagnostics belong in Runtime Debug/Event Bus,
      // never in conversation history. Normal provider/user-facing failures
      // retain the existing inline error behavior.
      if (!invariantViolation) this.deps.pushMessage('error', `Ошибка: ${message}`)
      try {
        await this.recoverToIdle(turn.turnId)
      } catch (cleanupError) {
        return { status: 'failed', turnId: turn.turnId, phase: 'cleanup', error: String(cleanupError) }
      }
      return { status: 'failed', turnId: turn.turnId, phase: failurePhase, error: message }
    }
  }

  private async executeDebug(
    turn: AdmittedConversationTurn,
    reportPhase: (phase: ConversationExecutionPhase) => void
  ): Promise<ConversationCompletionResult> {
    let failurePhase: 'synthesis' | 'playback' | 'cleanup' = 'synthesis'
    const emotionKey = turn.text || 'happy'
    try {
      this.deps.recordRuntimeEvent('Test Full Runtime Started', `turnId=${turn.turnId}`)
      this.prepareSpeech(emotionKey, `debug turnId=${turn.turnId}`)
      reportPhase('synthesizing')
      const speechTurn = await this.runSynthesis(turn.turnId, () => this.deps.speechRuntime.createDebugSpeechTurn(turn.turnId, emotionKey))
      if (!this.isCurrentTurn(turn.turnId)) return { status: 'cancelled', turnId: turn.turnId }
      this.rememberSpeech(speechTurn.speech, speechTurn.ttsLatencyText)

      failurePhase = 'playback'
      reportPhase('playing')
      this.playbackTurnId = turn.turnId
      await Promise.race([this.deps.player.play(speechTurn.speech.audioBuffer, {
        turnId: turn.turnId,
        onReady: (session) => this.startSpeech(session, speechTurn.speech, speechTurn.emotionKey, speechTurn.text),
        onProgress: (progress) => {
          if (this.isCurrentTurn(turn.turnId)) this.deps.updateSpeechPlaybackProgress(progress)
        }
      }), this.interruptionFor(turn.turnId)])
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null

      failurePhase = 'cleanup'
      reportPhase('cleaning_up')
      await this.finishSpeechCleanup(turn.turnId, 'Test Full Runtime Finished')
      return { status: 'completed', turnId: turn.turnId, playbackCompleted: true, cleanupCompleted: true }
    } catch (error) {
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes(`Conversation interrupted turnId=${turn.turnId}`)) {
        return { status: 'cancelled', turnId: turn.turnId }
      }
      await this.recoverToIdle(turn.turnId)
      return { status: 'failed', turnId: turn.turnId, phase: failurePhase, error: message }
    }
  }

  private async runGeneration<T>(turnId: string, operation: () => Promise<T>): Promise<T> {
    if (this.generationTurnId) throw new Error(`Generation overlap: activeTurnId=${this.generationTurnId} requestedTurnId=${turnId}`)
    this.generationTurnId = turnId
    console.debug(`[conversation] turnId=${turnId} generation=started`)
    try {
      const result = await Promise.race([operation(), this.interruptionFor(turnId)])
      if (!this.isCurrentTurn(turnId)) throw new Error(`Stale generation result turnId=${turnId}`)
      console.debug(`[conversation] turnId=${turnId} generation=completed`)
      return result
    } finally {
      if (this.generationTurnId === turnId) this.generationTurnId = null
    }
  }

  private async runSynthesis<T>(turnId: string, operation: () => Promise<T>): Promise<T> {
    if (this.synthesisTurnId) throw new Error(`Synthesis overlap: activeTurnId=${this.synthesisTurnId} requestedTurnId=${turnId}`)
    this.synthesisTurnId = turnId
    console.debug(`[conversation] turnId=${turnId} synthesis=started`)
    try {
      const result = await Promise.race([operation(), this.interruptionFor(turnId)])
      if (!this.isCurrentTurn(turnId)) throw new Error(`Stale synthesis result turnId=${turnId}`)
      console.debug(`[conversation] turnId=${turnId} synthesis=completed`)
      return result
    } finally {
      if (this.synthesisTurnId === turnId) this.synthesisTurnId = null
    }
  }

  private isCurrentTurn(turnId: string): boolean { return this.activeTurnId === turnId }
  private interruptionFor(turnId: string): Promise<never> {
    return this.interruption?.turnId === turnId ? this.interruption.promise : new Promise<never>(() => undefined)
  }

  private enterAvatarMode(mode: Exclude<AvatarMode, 'speaking' | 'awaitingSpeech'>, emotionKey: string, status: ConversationStatus): void {
    this.deps.updateCharacterState({ status, mode, emotion: emotionKey })
    this.applyAvatarCharacterState()
    this.publishAvatarState({ mode, emotionKey })
    this.deps.setStatus(status)
  }

  private prepareSpeech(emotionKey: string, eventDetail: string, replyText = ''): void {
    const conversationPresence = this.deps.conversationPresenceRuntime.update({ phase: 'startingSpeech', emotionKey, replyText })
    this.deps.updateCharacterState({ status: 'synthesizing', mode: 'awaitingSpeech', emotion: emotionKey, conversationPresence })
    this.applyAvatarCharacterState()
    this.deps.recordRuntimeEvent('Gesture Started', eventDetail)
    this.publishAvatarState({ mode: 'awaitingSpeech', emotionKey })
    this.deps.setStatus('synthesizing')
  }

  private startSpeech(session: PlaybackSession, speech: SuccessfulSpeechReply, fallbackEmotion: string, replyText = ''): void {
    if (!this.isCurrentTurn(session.turnId)) throw new Error(`Stale LipSync start turnId=${session.turnId}`)
    const emotionKey = speech.emotionKey ?? fallbackEmotion
    const conversationPresence = this.deps.conversationPresenceRuntime.update({ phase: 'speaking', replyText, emotionKey })
    this.deps.updateCharacterState({
      status: 'speaking', mode: 'speaking', emotion: emotionKey,
      vrmEmotion: speech.vrmEmotion, conversationPresence
    })
    this.applyAvatarCharacterState({ lipSyncSession: session })
    this.publishAvatarState({ mode: 'speaking', emotionKey, vrmEmotion: speech.vrmEmotion })
    this.deps.setStatus('speaking')
    this.publishRuntimeEvent('SpeechStarted', 'speech', `turnId=${session.turnId} playbackId=${session.playbackId}`)
    this.deps.recordRuntimeEvent('Audio Started', `turnId=${session.turnId} playbackId=${session.playbackId}`)
  }

  private async finishSpeechCleanup(turnId: string, extraEvent?: string): Promise<void> {
    if (!this.isCurrentTurn(turnId)) {
      console.debug(`[conversation] turnId=${turnId} stale-cleanup=ignored activeTurnId=${this.activeTurnId ?? 'none'}`)
      return
    }
    this.deps.avatarRuntime.stopLipSync(turnId)
    const finishing = this.deps.conversationPresenceRuntime.update({ phase: 'finishingSpeech' })
    this.deps.updateCharacterState({ status: 'idle', mode: 'idle', emotion: 'neutral', conversationPresence: finishing })
    this.applyAvatarCharacterState({ stopLipSyncTurnId: turnId })
    const waiting = this.deps.conversationPresenceRuntime.update({ phase: 'waiting' })
    this.deps.speechRuntime.updateConversationPresence(waiting)
    this.deps.updateSpeechPlaybackProgress(0)
    this.publishAvatarState({ mode: 'idle', emotionKey: 'neutral' })
    this.deps.setStatus('idle')
    this.publishRuntimeEvent('SpeechFinished', 'speech', `turnId=${turnId}`)
    this.deps.recordRuntimeEvent('Finished', `turnId=${turnId}`)
    this.deps.recordRuntimeEvent('Idle')
    if (extraEvent) this.deps.recordRuntimeEvent(extraEvent, `turnId=${turnId}`)
  }

  private async recoverToIdle(turnId: string): Promise<void> {
    if (!this.isCurrentTurn(turnId)) return
    this.deps.avatarRuntime.stopLipSync(turnId)
    this.enterAvatarMode('idle', 'neutral', 'idle')
  }

  private completeSilentReply(turnId: string, emotionKey: string, replyText: string): void {
    const listening = this.deps.isContinuousCaptureAlive()
    const status: ConversationStatus = listening ? 'listening' : 'idle'
    const mode: CharacterRuntimeMode = listening ? 'listening' : 'idle'
    const waiting = this.deps.conversationPresenceRuntime.update({ phase: 'waiting', replyText, emotionKey })
    this.deps.speechRuntime.updateConversationPresence(waiting)
    this.deps.updateCharacterState({ status, mode, emotion: emotionKey, conversationPresence: waiting })
    this.applyAvatarCharacterState()
    this.publishAvatarState({ mode, emotionKey })
    this.deps.updateSpeechPlaybackProgress(0)
    this.deps.setStatus(status)
    this.deps.recordRuntimeEvent('silent_expressive_reply', `turnId=${turnId} restored=${status}`)
    this.deps.recordRuntimeEvent('Finished', `turnId=${turnId}`)
  }

  private rememberSpeech(speech: SpeechReply, latencyText: string | null): void {
    this.deps.rememberSpeechMetadata(speech)
    if (latencyText) this.deps.pushMessage('meta', latencyText)
  }

  private applyAvatarCharacterState(
    options: Parameters<AvatarRuntime['applyCharacterState']>[1] = {}
  ): void {
    this.deps.avatarRuntime.applyCharacterState(this.deps.speechRuntime.getCharacterState(), options)
  }

  private publishAvatarState(state: SyncedAvatarState): void { this.deps.overlayRuntime.publishAvatarState(state) }

  private publishRuntimeEvent(type: RuntimeEventType, category: RuntimeEventCategory, detail?: string): void {
    this.deps.events.publish({ type, category, source: 'renderer.conversationRuntime', detail })
  }
}
