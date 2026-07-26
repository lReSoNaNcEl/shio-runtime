import type {
  CharacterConversationPresenceState,
  CharacterRuntimeMode,
  CharacterState,
  EventBus,
  RuntimeEventCategory,
  RuntimeEventType,
} from '../../shared/runtime'
import type { SerializedSpeechError } from '../../shared/speech'
import type { AudioPlayer, PlaybackSession } from '../audio/audioPlayer'
import { resolveEmotionEmbodimentProfile } from '../avatar/EmotionEmbodimentProfile'
import type { ChatMsg } from '../Controller'
import type {
  AdmittedConversationTurn,
  ConversationCompletionResult,
  ConversationExecutionPhase,
} from '../speech/continuous-listening/types'
import type { AvatarMode, AvatarRuntime } from './AvatarRuntime'
import type { ConversationPresenceRuntime } from './ConversationPresenceRuntime'
import { EmotionSpeechPipeline, type PreparedEmotionSpeechSegment } from './EmotionSpeechPipeline'
import type { OverlayRuntime, SyncedAvatarState } from './OverlayRuntime'
import {
  ConversationTurnFailureError,
  LlmCredentialMissingError,
  type SpeechRuntime,
} from './SpeechRuntime'
import { isSpeechServiceError } from './speechCapabilities'

export type ConversationStatus =
  | 'idle'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'synthesizing'
  | 'speaking'
export type ResponseInterruptionReason = 'manual-stop' | 'voice-barge-in' | 'new-conversation'

export class ConversationInterruptedError extends Error {
  constructor(
    readonly turnId: string,
    readonly source: ResponseInterruptionReason,
  ) {
    super(`Conversation interrupted turnId=${turnId}`)
    this.name = 'ConversationInterruptedError'
  }
}

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
  formatUserError: (message: string) => string
  markAssistantMessageInterrupted: () => void
  setResponseInterruptionPending: (pending: boolean) => void
  recordRuntimeEvent: (label: string, detail?: string) => void
  /** Report a normalized Speech Adapter failure to the capabilities health component. */
  reportSpeechServiceError: (error: SerializedSpeechError) => void
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
  handleLlmSetupRequired: (userText: string) => void
}

export class ConversationRuntime {
  private activeTurnId: string | null = null
  private activePhase: ConversationExecutionPhase | null = null
  private playbackStartedAt: number | null = null
  private generationTurnId: string | null = null
  private synthesisTurnId: string | null = null
  private playbackTurnId: string | null = null
  private activeEmotionPipeline: EmotionSpeechPipeline | null = null
  private interruption: {
    turnId: string
    promise: Promise<never>
    reject: (error: Error) => void
  } | null = null

  constructor(private readonly deps: ConversationRuntimeDeps) {}

  async execute(
    turn: AdmittedConversationTurn,
    reportPhase: (phase: ConversationExecutionPhase) => void,
  ): Promise<ConversationCompletionResult> {
    if (this.activeTurnId) {
      return {
        status: 'failed',
        turnId: turn.turnId,
        phase: 'generation',
        error: `Conversation Runtime overlap: activeTurnId=${this.activeTurnId} requestedTurnId=${turn.turnId}`,
      }
    }
    this.activeTurnId = turn.turnId
    this.activePhase = turn.source === 'debug' ? 'synthesizing' : 'generating'
    this.playbackStartedAt = null
    const trackPhase = (phase: ConversationExecutionPhase): void => {
      if (this.activeTurnId === turn.turnId) this.activePhase = phase
      reportPhase(phase)
    }
    let reject!: (error: Error) => void
    const promise = new Promise<never>((_, fail) => {
      reject = fail
    })
    this.interruption = { turnId: turn.turnId, promise, reject }
    console.debug(
      `[conversation] turnId=${turn.turnId} source=${turn.source} cycleId=${turn.admissionCycleId} started`,
    )
    try {
      return turn.source === 'debug'
        ? await this.executeDebug(turn, trackPhase)
        : await this.executeConversation(turn, trackPhase)
    } finally {
      if (this.activeTurnId === turn.turnId) this.activeTurnId = null
      if (this.activeTurnId === null) {
        this.activePhase = null
        this.playbackStartedAt = null
      }
      if (this.interruption?.turnId === turn.turnId) {
        this.interruption = null
        this.deps.setResponseInterruptionPending(false)
      }
    }
  }

  async interruptCurrentResponse(source: ResponseInterruptionReason): Promise<boolean> {
    const turnId = this.activeTurnId
    const interruption = this.interruption
    if (!turnId || !interruption || interruption.turnId !== turnId) return false
    this.deps.setResponseInterruptionPending(true)
    this.activeEmotionPipeline?.cancel()
    this.activeTurnId = null
    this.activePhase = null
    this.playbackStartedAt = null
    // Settle the local execution before asking external adapters to cancel.
    // Adapter AbortErrors can therefore never win the local interruption race.
    interruption.reject(new ConversationInterruptedError(turnId, source))
    this.deps.player.stopCurrent(turnId, 'conversation-interrupted')
    this.deps.avatarRuntime.interruptLipSync(turnId)
    this.deps.markAssistantMessageInterrupted()
    const listening = this.deps.isContinuousCaptureAlive()
    const status: ConversationStatus = listening ? 'listening' : 'idle'
    const mode: CharacterRuntimeMode = listening ? 'listening' : 'idle'
    const waiting = this.deps.conversationPresenceRuntime.update({ phase: 'waiting' })
    this.deps.speechRuntime.updateConversationPresence(waiting)
    this.deps.updateCharacterState({
      status,
      mode,
      emotion: 'neutral',
      conversationPresence: waiting,
    })
    this.applyAvatarCharacterState({ stopLipSyncTurnId: turnId })
    if (source === 'voice-barge-in') {
      try {
        this.deps.avatarRuntime.triggerUserInterruption()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.deps.recordRuntimeEvent('User Interruption Reaction Failed', message)
      }
    }
    this.publishAvatarState({
      mode,
      emotionKey: 'neutral',
      reaction: source === 'voice-barge-in' ? 'user-interruption' : undefined,
      reactionId: source === 'voice-barge-in' ? `${turnId}:${Date.now()}` : undefined,
    })
    this.deps.updateSpeechPlaybackProgress(0)
    this.deps.setStatus(status)
    this.deps.recordRuntimeEvent('Conversation Interrupted', `turnId=${turnId} source=${source}`)
    this.publishRuntimeEvent('ResponseInterrupted', 'speech', `turnId=${turnId} source=${source}`)
    await Promise.allSettled([
      window.api.llm.cancelReply(turnId),
      window.api.tts.cancelSynthesis(turnId),
    ])
    return true
  }

  getActiveResponseSnapshot(): {
    turnId: string | null
    phase: ConversationExecutionPhase | null
    playbackStartedAt: number | null
  } {
    return {
      turnId: this.activeTurnId,
      phase: this.activePhase,
      playbackStartedAt: this.playbackStartedAt,
    }
  }

  private async executeConversation(
    turn: AdmittedConversationTurn,
    reportPhase: (phase: ConversationExecutionPhase) => void,
  ): Promise<ConversationCompletionResult> {
    let failurePhase: 'generation' | 'synthesis' | 'playback' | 'cleanup' = 'generation'
    try {
      const thinkingPresence = this.deps.conversationPresenceRuntime.update({
        phase: 'thinking',
        userText: turn.text,
      })
      this.enterAvatarMode('thinking', 'calm', 'thinking')
      this.deps.speechRuntime.updateConversationPresence(thinkingPresence)
      this.deps.recordRuntimeEvent('Thinking', `turnId=${turn.turnId}`)
      reportPhase('generating')
      const draft = await this.runGeneration(turn.turnId, () =>
        this.deps.speechRuntime.createAssistantReply(turn.turnId, turn.text, turn.screenContextId),
      )
      if (!this.isCurrentTurn(turn.turnId)) return { status: 'cancelled', turnId: turn.turnId }

      this.publishRuntimeEvent('SentenceGenerated', 'speech', `turnId=${turn.turnId}`)
      const generatedPresence = this.deps.conversationPresenceRuntime.update({
        phase: 'preparingReply',
        userText: turn.text,
        replyText: draft.displayText,
        emotionKey: draft.emotionKey,
      })
      this.deps.speechRuntime.updateConversationPresence(generatedPresence)
      this.deps.pushMessage('assistant', draft.displayText)

      if (!this.deps.speechRuntime.hasSpeakableContent(draft.speechText)) {
        reportPhase('cleaning_up')
        this.completeSilentReply(turn.turnId, draft.emotionKey, draft.displayText)
        return {
          status: 'completed',
          turnId: turn.turnId,
          playbackCompleted: false,
          cleanupCompleted: true,
        }
      }

      this.prepareSpeech(draft.emotionKey, `turnId=${turn.turnId}`, draft.displayText)

      failurePhase = 'synthesis'
      reportPhase('synthesizing')
      this.playbackTurnId = turn.turnId
      this.deps.recordRuntimeEvent(
        'Emotion Segments Parsed',
        draft.segments.map((segment) => segment.emotion).join(' → '),
      )
      if (draft.segments.length === 1) {
        const segment = draft.segments[0]
        failurePhase = 'synthesis'
        const speech = await this.runSynthesis(turn.turnId, () =>
          this.deps.speechRuntime.synthesizeSegment(turn.turnId, segment),
        )
        this.rememberSpeech(speech, null)
        failurePhase = 'playback'
        reportPhase('playing')
        await Promise.race([
          this.deps.player.play(speech.audioBuffer, {
            turnId: turn.turnId,
            onReady: (session) => {
              if (!this.isCurrentTurn(turn.turnId))
                throw new Error(`Stale playback ready turnId=${turn.turnId}`)
              this.startSpeech(session, speech, segment.emotion, segment.text)
            },
            onProgress: (progress) => {
              if (this.isCurrentTurn(turn.turnId)) this.deps.updateSpeechPlaybackProgress(progress)
            },
          }),
          this.interruptionFor(turn.turnId),
        ])
      } else {
        const segmentWeights = draft.segments.map((segment) =>
          Math.max(1, segment.text.trim().length),
        )
        const totalWeight = segmentWeights.reduce((sum, weight) => sum + weight, 0)
        let completedWeight = 0
        let playbackPhaseStarted = false
        let synthesisFailure: unknown = null
        const pipeline = new EmotionSpeechPipeline({
          turnId: turn.turnId,
          segments: draft.segments,
          synthesize: async (segment) => {
            try {
              return await this.runSynthesis(turn.turnId, () =>
                this.deps.speechRuntime.synthesizeSegment(turn.turnId, segment),
              )
            } catch (error) {
              synthesisFailure = error
              throw error
            }
          },
          prepareAudio: (audioBuffer) => this.deps.player.prepare(audioBuffer),
          playPrepared: async (item, onStarted) => {
            this.rememberSpeech(item.speech, null)
            failurePhase = 'playback'
            await this.playPreparedEmotionSegment(
              turn.turnId,
              item,
              (session) => {
                if (!playbackPhaseStarted) {
                  playbackPhaseStarted = true
                  reportPhase('playing')
                }
                this.startSpeech(session, item.speech, item.segment.emotion, item.segment.text)
              },
              (progress) => {
                if (!this.isCurrentTurn(turn.turnId)) return
                const currentWeight = segmentWeights[item.segment.index] ?? 1
                this.deps.updateSpeechPlaybackProgress(
                  (completedWeight + progress * currentWeight) / totalWeight,
                )
              },
              onStarted,
            )
            completedWeight += segmentWeights[item.segment.index] ?? 1
            if (this.isCurrentTurn(turn.turnId))
              this.deps.updateSpeechPlaybackProgress(completedWeight / totalWeight)
          },
          isCurrentTurn: () => this.isCurrentTurn(turn.turnId),
          recordEvent: (label, detail) => this.deps.recordRuntimeEvent(label, detail),
        })
        this.activeEmotionPipeline = pipeline
        try {
          await Promise.race([pipeline.execute(), this.interruptionFor(turn.turnId)])
        } catch (error) {
          if (error === synthesisFailure) failurePhase = 'synthesis'
          throw error
        } finally {
          if (this.activeEmotionPipeline === pipeline) this.activeEmotionPipeline = null
        }
      }
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null
      if (!this.isCurrentTurn(turn.turnId)) return { status: 'cancelled', turnId: turn.turnId }

      failurePhase = 'cleanup'
      reportPhase('cleaning_up')
      await this.finishSpeechCleanup(turn.turnId)
      console.debug(`[conversation] turnId=${turn.turnId} cleanup=completed`)
      return {
        status: 'completed',
        turnId: turn.turnId,
        playbackCompleted: true,
        cleanupCompleted: true,
      }
    } catch (error) {
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null
      const message = error instanceof Error ? error.message : String(error)
      if (
        (error instanceof ConversationInterruptedError && error.turnId === turn.turnId) ||
        !this.isCurrentTurn(turn.turnId)
      ) {
        return { status: 'cancelled', turnId: turn.turnId }
      }
      if (error instanceof LlmCredentialMissingError) {
        this.deps.handleLlmSetupRequired(turn.text)
        this.deps.recordRuntimeEvent('LLM Setup Required', `turnId=${turn.turnId}`)
        await this.recoverToIdle(turn.turnId)
        return { status: 'failed', turnId: turn.turnId, phase: failurePhase, error: error.message }
      }
      if (error instanceof ConversationTurnFailureError) {
        const { failure } = error
        this.deps.recordRuntimeEvent(
          'Conversation Turn Failed',
          `provider=${failure.providerId ?? 'none'} turnId=${turn.turnId} code=${failure.code} vision=${Boolean(turn.screenContextId)} attachmentDisposition=${failure.attachmentDisposition} retrySameRequest=${failure.retrySameRequest} canResubmitWithoutImage=${failure.canResubmitWithoutImage}`,
        )
        try {
          await this.recoverToIdle(turn.turnId)
        } catch (cleanupError) {
          return {
            status: 'failed',
            turnId: turn.turnId,
            phase: 'cleanup',
            error: String(cleanupError),
          }
        }
        return {
          status: 'failed',
          turnId: turn.turnId,
          phase: failurePhase,
          error: failure.code,
          failure,
        }
      }
      // Speech output (TTS) is a secondary capability. If synthesis fails because
      // the Speech API is unavailable, the reply text has already been shown
      // (pushed before synthesis). The turn is therefore a successful conversation
      // completion — the failure is a Speech capability failure, not a turn
      // failure — so we degrade to a stable idle state without a red chat error.
      if (isSpeechServiceError(error) && error.operation === 'synthesis') {
        this.deps.recordRuntimeEvent(
          'synthesis_degraded',
          `turnId=${turn.turnId} code=${error.code}`,
        )
        this.deps.reportSpeechServiceError(error.toSerialized())
        try {
          await this.recoverToIdle(turn.turnId)
        } catch (cleanupError) {
          return {
            status: 'failed',
            turnId: turn.turnId,
            phase: 'cleanup',
            error: String(cleanupError),
          }
        }
        return {
          status: 'completed',
          turnId: turn.turnId,
          playbackCompleted: false,
          cleanupCompleted: true,
        }
      }
      const invariantViolation =
        /(?:Character generation|Generation|TTS synthesis|Synthesis|Conversation Runtime|Conversation execution|Parallel playback) overlap|Parallel playback rejected/i.test(
          message,
        )
      this.deps.recordRuntimeEvent(
        invariantViolation ? 'conversation.invariant_violation' : `${failurePhase} Error`,
        `turnId=${turn.turnId} phase=${failurePhase} ${message}`,
      )
      // Internal concurrency diagnostics belong in Runtime Debug/Event Bus,
      // never in conversation history. Normal provider/user-facing failures
      // retain the existing inline error behavior.
      if (!invariantViolation) this.deps.pushMessage('error', this.deps.formatUserError(message))
      try {
        await this.recoverToIdle(turn.turnId)
      } catch (cleanupError) {
        return {
          status: 'failed',
          turnId: turn.turnId,
          phase: 'cleanup',
          error: String(cleanupError),
        }
      }
      return { status: 'failed', turnId: turn.turnId, phase: failurePhase, error: message }
    }
  }

  private async executeDebug(
    turn: AdmittedConversationTurn,
    reportPhase: (phase: ConversationExecutionPhase) => void,
  ): Promise<ConversationCompletionResult> {
    let failurePhase: 'synthesis' | 'playback' | 'cleanup' = 'synthesis'
    const emotionKey = turn.text || 'happy'
    try {
      this.deps.recordRuntimeEvent('Test Full Runtime Started', `turnId=${turn.turnId}`)
      this.prepareSpeech(emotionKey, `debug turnId=${turn.turnId}`)
      reportPhase('synthesizing')
      const speechTurn = await this.runSynthesis(turn.turnId, () =>
        this.deps.speechRuntime.createDebugSpeechTurn(turn.turnId, emotionKey),
      )
      if (!this.isCurrentTurn(turn.turnId)) return { status: 'cancelled', turnId: turn.turnId }
      this.rememberSpeech(speechTurn.speech, speechTurn.ttsLatencyText)

      failurePhase = 'playback'
      reportPhase('playing')
      this.playbackTurnId = turn.turnId
      await Promise.race([
        this.deps.player.play(speechTurn.speech.audioBuffer, {
          turnId: turn.turnId,
          onReady: (session) =>
            this.startSpeech(session, speechTurn.speech, speechTurn.emotionKey, speechTurn.text),
          onProgress: (progress) => {
            if (this.isCurrentTurn(turn.turnId)) this.deps.updateSpeechPlaybackProgress(progress)
          },
        }),
        this.interruptionFor(turn.turnId),
      ])
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null

      failurePhase = 'cleanup'
      reportPhase('cleaning_up')
      await this.finishSpeechCleanup(turn.turnId, 'Test Full Runtime Finished')
      return {
        status: 'completed',
        turnId: turn.turnId,
        playbackCompleted: true,
        cleanupCompleted: true,
      }
    } catch (error) {
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null
      const message = error instanceof Error ? error.message : String(error)
      if (
        (error instanceof ConversationInterruptedError && error.turnId === turn.turnId) ||
        !this.isCurrentTurn(turn.turnId)
      ) {
        return { status: 'cancelled', turnId: turn.turnId }
      }
      await this.recoverToIdle(turn.turnId)
      return { status: 'failed', turnId: turn.turnId, phase: failurePhase, error: message }
    }
  }

  private async runGeneration<T>(turnId: string, operation: () => Promise<T>): Promise<T> {
    if (this.generationTurnId)
      throw new Error(
        `Generation overlap: activeTurnId=${this.generationTurnId} requestedTurnId=${turnId}`,
      )
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
    if (this.synthesisTurnId)
      throw new Error(
        `Synthesis overlap: activeTurnId=${this.synthesisTurnId} requestedTurnId=${turnId}`,
      )
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

  private isCurrentTurn(turnId: string): boolean {
    return this.activeTurnId === turnId
  }
  private interruptionFor(turnId: string): Promise<never> {
    return this.interruption?.turnId === turnId
      ? this.interruption.promise
      : new Promise<never>(() => undefined)
  }

  private enterAvatarMode(
    mode: Exclude<AvatarMode, 'speaking' | 'awaitingSpeech'>,
    emotionKey: string,
    status: ConversationStatus,
  ): void {
    this.deps.updateCharacterState({ status, mode, emotion: emotionKey })
    this.applyAvatarCharacterState()
    const thinkingImpulse =
      mode === 'thinking' && this.deps.avatarRuntime.triggerEarImpulse('thinking-entry')
    this.publishAvatarState({
      mode,
      emotionKey,
      earImpulse: thinkingImpulse ? 'thinking-entry' : undefined,
      earImpulseId: thinkingImpulse ? `thinking:${Date.now()}` : undefined,
    })
    this.deps.setStatus(status)
  }

  private prepareSpeech(emotionKey: string, eventDetail: string, replyText = ''): void {
    const conversationPresence = this.deps.conversationPresenceRuntime.update({
      phase: 'startingSpeech',
      emotionKey,
      replyText,
    })
    this.deps.updateCharacterState({
      status: 'synthesizing',
      mode: 'awaitingSpeech',
      emotion: emotionKey,
      conversationPresence,
    })
    this.applyAvatarCharacterState()
    this.deps.recordRuntimeEvent('Gesture Started', eventDetail)
    this.publishAvatarState({ mode: 'awaitingSpeech', emotionKey })
    this.deps.setStatus('synthesizing')
  }

  private startSpeech(
    session: PlaybackSession,
    speech: SuccessfulSpeechReply,
    fallbackEmotion: string,
    replyText = '',
  ): void {
    if (!this.isCurrentTurn(session.turnId))
      throw new Error(`Stale LipSync start turnId=${session.turnId}`)
    this.playbackStartedAt = session.startedAt
    const emotionKey = speech.emotionKey ?? fallbackEmotion
    const embodiment = resolveEmotionEmbodimentProfile(emotionKey)
    const conversationPresence = this.deps.conversationPresenceRuntime.update({
      phase: 'speaking',
      replyText,
      emotionKey,
    })
    this.deps.updateCharacterState({
      status: 'speaking',
      mode: 'speaking',
      emotion: emotionKey,
      vrmEmotion: speech.vrmEmotion,
      conversationPresence,
    })
    this.applyAvatarCharacterState({
      lipSyncStart: {
        session,
        text: replyText,
        emotionKey,
      },
    })
    const replyEmphasis =
      (embodiment.id === 'happy' || embodiment.id === 'angry' || embodiment.id === 'surprised') &&
      this.deps.avatarRuntime.triggerEarImpulse('reply-emphasis', session.playbackId)
    if (embodiment.id === 'surprised') this.deps.avatarRuntime.triggerReactionGesture('surprise')
    this.publishAvatarState({
      mode: 'speaking',
      emotionKey,
      vrmEmotion: speech.vrmEmotion,
      earImpulse: replyEmphasis ? 'reply-emphasis' : undefined,
      earImpulseId: replyEmphasis ? session.playbackId : undefined,
    })
    this.deps.setStatus('speaking')
    this.publishRuntimeEvent(
      'SpeechStarted',
      'speech',
      `turnId=${session.turnId} playbackId=${session.playbackId}`,
    )
    this.deps.recordRuntimeEvent(
      'Audio Started',
      `turnId=${session.turnId} playbackId=${session.playbackId}`,
    )
  }

  private async playPreparedEmotionSegment(
    turnId: string,
    item: PreparedEmotionSpeechSegment,
    onReady: Parameters<AudioPlayer['playPrepared']>[1]['onReady'],
    onProgress: (progress: number) => void,
    onStarted: () => void,
  ): Promise<void> {
    await this.deps.player.playPrepared(item.audio, {
      turnId,
      onReady: (session) => {
        if (!this.isCurrentTurn(turnId)) throw new Error(`Stale playback ready turnId=${turnId}`)
        return onReady(session)
      },
      onProgress,
      onStarted,
    })
  }

  private async finishSpeechCleanup(turnId: string, extraEvent?: string): Promise<void> {
    if (!this.isCurrentTurn(turnId)) {
      console.debug(
        `[conversation] turnId=${turnId} stale-cleanup=ignored activeTurnId=${this.activeTurnId ?? 'none'}`,
      )
      return
    }
    this.deps.avatarRuntime.stopLipSync(turnId)
    const finishing = this.deps.conversationPresenceRuntime.update({ phase: 'finishingSpeech' })
    this.deps.updateCharacterState({
      status: 'idle',
      mode: 'idle',
      emotion: 'neutral',
      conversationPresence: finishing,
    })
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
    const waiting = this.deps.conversationPresenceRuntime.update({
      phase: 'waiting',
      replyText,
      emotionKey,
    })
    this.deps.speechRuntime.updateConversationPresence(waiting)
    this.deps.updateCharacterState({
      status,
      mode,
      emotion: emotionKey,
      conversationPresence: waiting,
    })
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
    options: Parameters<AvatarRuntime['applyCharacterState']>[1] = {},
  ): void {
    this.deps.avatarRuntime.applyCharacterState(
      this.deps.speechRuntime.getCharacterState(),
      options,
    )
  }

  private publishAvatarState(state: SyncedAvatarState): void {
    this.deps.overlayRuntime.publishAvatarState(state)
  }

  private publishRuntimeEvent(
    type: RuntimeEventType,
    category: RuntimeEventCategory,
    detail?: string,
  ): void {
    this.deps.events.publish({ type, category, source: 'renderer.conversationRuntime', detail })
  }
}
