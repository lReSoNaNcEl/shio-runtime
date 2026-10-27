import type { ExperienceEvent } from '../../shared/alive'
import type {
  CharacterEmbodimentIntent,
  EmbodimentIntentContext,
} from '../../shared/character-response'
import {
  characterRequestId,
  SafeCharacterStreamFilter,
  type SpeechTextCommit,
  SpeechTextCommitBuffer,
} from '../../shared/character-stream'
import type { AttachmentDisposition, ReplyGrounding } from '../../shared/conversation'
import type { LatencyMilestoneName } from '../../shared/latency'
import type {
  CharacterConversationPresenceState,
  CharacterRuntimeMode,
  EventBus,
  RuntimeEventCategory,
  RuntimeEventType,
} from '../../shared/runtime'
import type { SerializedSpeechError } from '../../shared/speech'
import { resolveEmotionEmbodimentProfile } from '../avatar/EmotionEmbodimentProfile'
import type { ChatMsg } from '../Controller'
import type {
  AdmittedConversationTurn,
  ConversationCompletionResult,
  ConversationExecutionPhase,
} from '../speech/continuous-listening/types'
import {
  type CharacterResponsePort,
  ConversationTurnFailureError,
  LlmCredentialMissingError,
  LlmModelMissingError,
} from './CharacterResponsePort'
import type { CharacterStateReader, ConversationStateWriter } from './CharacterStateStore'
import type { ConversationPresenceInput } from './ConversationPresenceRuntime'
import type {
  ConversationAvatarProjection,
  ConversationPresentationPort,
} from './ConversationPresentationPort'
import type {
  SpeechOutputPort,
  SpeechOutputStream,
  SpeechPlaybackSession,
} from './SpeechOutputPort'
import { deliveryIntent } from './SpeechOutputPort'

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

interface SpeechReplyMetadata {
  emotionKey?: string
  vrmEmotion?: string
  latencyMs?: string
  cache?: string
}

export interface ConversationRuntimeDeps {
  speechOutput: SpeechOutputPort
  characterResponse: CharacterResponsePort
  characterState: CharacterStateReader
  conversationState: ConversationStateWriter
  conversationPresence: {
    update(input: ConversationPresenceInput): CharacterConversationPresenceState
  }
  presentation: ConversationPresentationPort
  events: EventBus
  setStatus: (status: ConversationStatus) => void
  pushMessage: (
    role: ChatMsg['role'],
    text: string,
    grounding?: ReplyGrounding,
    streaming?: boolean,
  ) => string
  updateMessage: (
    id: string,
    text: string,
    grounding?: ReplyGrounding,
    streaming?: boolean,
    immediate?: boolean,
  ) => void
  formatUserError: (message: string) => string
  markAssistantMessageInterrupted: () => void
  setResponseInterruptionPending: (pending: boolean) => void
  recordRuntimeEvent: (label: string, detail?: string) => void
  /** Report a normalized Speech Adapter failure to the capabilities health component. */
  reportSpeechServiceError: (error: SerializedSpeechError) => void
  rememberSpeechMetadata: (speech: SpeechReplyMetadata) => void
  updateSpeechPlaybackProgress: (progress: number) => void
  isContinuousCaptureAlive: () => boolean
  handleLlmSetupRequired: (userText: string, reason: 'missing-credential' | 'model-missing') => void
  reportExperience?: (event: ExperienceEvent) => void
}

export class ConversationRuntime {
  private readonly cancellations = new Map<string, Set<Promise<void>>>()
  private activeTurnId: string | null = null
  private activePhase: ConversationExecutionPhase | null = null
  private playbackStartedAt: number | null = null
  private generationTurnId: string | null = null
  private playbackTurnId: string | null = null
  private activeSpeechStream: SpeechOutputStream | null = null
  private embodimentIntent: CharacterEmbodimentIntent | undefined
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
    this.recordLatency(turn.turnId, 'admission_requested', 'started')
    this.recordLatency(turn.turnId, 'turn_admitted', 'success')
    try {
      const result =
        turn.source === 'debug'
          ? await this.executeDebug(turn, trackPhase)
          : await this.executeConversation(turn, trackPhase)
      if (result.status === 'completed' && turn.source !== 'debug') {
        this.deps.reportExperience?.({
          type: 'conversation-completed',
          at: Date.now(),
          turnId: turn.turnId,
        })
      }
      this.deps.recordRuntimeEvent(
        'Conversation Terminal',
        `turnId=${turn.turnId} result=${result.status}${result.status === 'failed' ? ` phase=${result.phase} code=${result.failure?.code ?? 'UNCLASSIFIED'}` : ''}`,
      )
      this.recordLatency(
        turn.turnId,
        'turn_terminal',
        result.status === 'completed'
          ? 'success'
          : result.status === 'cancelled'
            ? 'cancelled'
            : 'failure',
      )
      return result
    } catch (error) {
      this.recordLatency(turn.turnId, 'turn_terminal', 'failure')
      this.deps.recordRuntimeEvent(
        'Conversation Terminal',
        `turnId=${turn.turnId} result=threw code=${error instanceof Error ? error.name : 'UNKNOWN'}`,
      )
      throw error
    } finally {
      await Promise.all(this.cancellations.get(turn.turnId) ?? [])
      await this.deps.presentation.settleMotionCancellation?.()
      this.cancellations.delete(turn.turnId)
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
    const speechStream = this.activeSpeechStream
    this.activeSpeechStream = null
    this.activeTurnId = null
    this.activePhase = null
    this.playbackStartedAt = null
    // Settle the local execution before asking external adapters to cancel.
    // Adapter AbortErrors can therefore never win the local interruption race.
    interruption.reject(new ConversationInterruptedError(turnId, source))
    try {
      speechStream?.cancel('conversation-interrupted')
    } catch (error) {
      this.recordCancellationFailure('Speech Stream', turnId, error)
    }
    // Backend cancellation must be dispatched before any presentation/state
    // work. A failed Character State transition must never strand the model
    // generator or its inference lock.
    this.observeAdapterCancellation('LLM', () => window.api.llm.cancelReply(turnId), turnId)
    this.observeAdapterCancellation('Speech', () => window.api.tts.cancelSynthesis(turnId), turnId)
    let listening = false
    try {
      listening = this.deps.isContinuousCaptureAlive()
    } catch (error) {
      this.recordCancellationFailure('Continuous Capture', turnId, error)
    }
    const status: ConversationStatus = listening ? 'listening' : 'idle'
    const mode: CharacterRuntimeMode = listening ? 'listening' : 'idle'
    // Reset the visible control state before best-effort presentation cleanup.
    this.deps.updateSpeechPlaybackProgress(0)
    this.deps.setStatus(status)
    try {
      this.setEmbodimentIntent(undefined)
      this.deps.speechOutput.stopCurrent(turnId, 'conversation-interrupted')
      this.deps.presentation.interruptLipSync(turnId)
      this.deps.markAssistantMessageInterrupted()
      const waiting = this.deps.conversationPresence.update({ phase: 'waiting' })
      this.deps.conversationState.setPresence(waiting)
      this.deps.conversationState.transition({
        status,
        mode,
        emotion: 'neutral',
        conversationPresence: waiting,
      })
      this.applyAvatarCharacterState({ stopLipSyncTurnId: turnId })
      if (source === 'voice-barge-in') {
        this.deps.presentation.triggerUserInterruption()
      }
      this.publishAvatarState({
        mode,
        emotionKey: 'neutral',
        reaction: source === 'voice-barge-in' ? 'user-interruption' : undefined,
        reactionId: source === 'voice-barge-in' ? `${turnId}:${Date.now()}` : undefined,
      })
    } catch (error) {
      this.recordCancellationFailure('Presentation', turnId, error)
    }
    this.deps.recordRuntimeEvent('Conversation Interrupted', `turnId=${turnId} source=${source}`)
    this.deps.reportExperience?.({ type: 'conversation-interrupted', at: Date.now(), turnId })
    this.publishRuntimeEvent('ResponseInterrupted', 'speech', `turnId=${turnId} source=${source}`)
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
    let attachmentDisposition: AttachmentDisposition = turn.screenContextId
      ? 'retained'
      : 'released'
    let streamedDisplayText = ''
    let streamedMessageId: string | null = null
    let streamedMessageFinalized = false
    let playbackStarted = false
    let streamedEmbodimentReceived = false
    let spokenCommitCount = 0
    let speechStream: SpeechOutputStream | null = null
    const commitBuffer = new SpeechTextCommitBuffer(turn.turnId)

    try {
      this.setEmbodimentIntent(
        turn.screenContextId ? { intensity: 'subtle', gazeHint: 'screen' } : undefined,
      )
      const thinkingPresence = this.deps.conversationPresence.update({
        phase: 'thinking',
        userText: turn.text,
      })
      this.enterAvatarMode('thinking', 'calm', 'thinking')
      this.deps.conversationState.setPresence(thinkingPresence)
      this.deps.recordRuntimeEvent('Thinking', `turnId=${turn.turnId}`)
      reportPhase('generating')

      const ensureSpeechStream = (commit: SpeechTextCommit): SpeechOutputStream => {
        if (speechStream) return speechStream
        failurePhase = 'synthesis'
        this.playbackTurnId = turn.turnId
        this.prepareSpeech(commit.emotion, `stream turnId=${turn.turnId}`, streamedDisplayText)
        reportPhase('synthesizing')
        this.recordLatency(turn.turnId, 'tts_segment_requested', 'started', {
          ttsSegmentId: turn.turnId,
        })
        speechStream = this.deps.speechOutput.openStream(
          turn.turnId,
          deliveryIntent(commit.emotion, commit.voiceStyle),
          {
            turnId: turn.turnId,
            onFirstPcm: () => {
              this.recordLatency(turn.turnId, 'first_audio_ready', 'success')
              this.recordLatency(turn.turnId, 'tts_segment_ready', 'success', {
                ttsSegmentId: turn.turnId,
              })
              this.recordLatency(turn.turnId, 'audio_ready', 'success', {
                ttsSegmentId: turn.turnId,
              })
            },
            onDelivery: (emotion) => {
              if (this.isCurrentTurn(turn.turnId))
                this.deps.presentation.setSpeechDelivery?.(emotion)
            },
            onReady: (session) => {
              if (!this.isCurrentTurn(turn.turnId))
                throw new Error(`Stale playback ready turnId=${turn.turnId}`)
              failurePhase = 'playback'
              reportPhase('playing')
              this.deps.rememberSpeechMetadata({
                emotionKey: commit.emotion,
              })
              this.startSpeech(
                session,
                { emotionKey: commit.emotion },
                commit.emotion,
                streamedDisplayText,
              )
            },
            onStarted: () => {
              playbackStarted = true
              this.recordLatency(turn.turnId, 'playback_started', 'success', {
                ttsSegmentId: turn.turnId,
              })
            },
            onProgress: (progress) => {
              if (this.isCurrentTurn(turn.turnId)) this.deps.updateSpeechPlaybackProgress(progress)
            },
          },
        )
        this.activeSpeechStream = speechStream
        return speechStream
      }

      const commitSpeech = (commits: readonly SpeechTextCommit[]): void => {
        for (const commit of commits) {
          if (spokenCommitCount === 0)
            this.recordLatency(turn.turnId, 'llm_first_sentence', 'success')
          ensureSpeechStream(commit).commit(commit)
          spokenCommitCount += 1
          this.deps.recordRuntimeEvent(
            'Speech Text Committed',
            `turnId=${turn.turnId} sequence=${commit.sequence} boundary=${commit.boundary} characters=${commit.text.length}`,
          )
        }
      }

      const draft = await this.runGeneration(turn.turnId, () =>
        this.deps.characterResponse.createReply(
          turn.turnId,
          turn.text,
          turn.screenContextId,
          (event) => {
            this.deps.recordRuntimeEvent(
              `LLM Stream ${event.type}`,
              `turnId=${turn.turnId} round=${event.llmRound}`,
            )
            if (!this.isCurrentTurn(turn.turnId)) return
            if (event.type === 'embodiment-intent') {
              streamedEmbodimentReceived = true
              this.setEmbodimentIntent(event.intent, {
                receivedAt: event.at,
                turnId: turn.turnId,
                eligibility:
                  event.timing === 'early' && !playbackStarted ? 'opening' : 'future-only',
              })
              return
            }
            if (event.type !== 'text-delta') {
              if (
                streamedMessageId &&
                (event.type === 'tool-round-started' ||
                  event.type === 'tool-round-completed' ||
                  event.type === 'completed')
              ) {
                this.deps.updateMessage(
                  streamedMessageId,
                  streamedDisplayText,
                  undefined,
                  true,
                  true,
                )
              }
              return
            }
            streamedDisplayText += event.delta.text
            if (!streamedMessageId && streamedDisplayText.trim()) {
              streamedMessageId = this.deps.pushMessage(
                'assistant',
                streamedDisplayText,
                undefined,
                true,
              )
            } else if (streamedMessageId) {
              this.deps.updateMessage(streamedMessageId, streamedDisplayText, undefined, true)
            }
            commitSpeech(commitBuffer.push(event.delta))
          },
          turn.source === 'autonomous_initiative' ? 'autonomous' : 'user',
        ),
      )
      attachmentDisposition = 'released'
      if (!this.isCurrentTurn(turn.turnId)) {
        return { status: 'cancelled', turnId: turn.turnId, attachmentDisposition }
      }

      if (!streamedEmbodimentReceived)
        this.setEmbodimentIntent(draft.embodimentIntent, {
          receivedAt: Date.now(),
          turnId: turn.turnId,
          eligibility: playbackStarted ? 'future-only' : 'opening',
        })
      this.publishRuntimeEvent('SentenceGenerated', 'speech', `turnId=${turn.turnId}`)
      const generatedPresence = this.deps.conversationPresence.update({
        phase: 'preparingReply',
        userText: turn.text,
        replyText: draft.displayText,
        emotionKey: draft.emotionKey,
      })
      this.deps.conversationState.setPresence(generatedPresence)

      if (streamedMessageId) {
        this.deps.updateMessage(streamedMessageId, draft.displayText, draft.grounding, false, true)
      } else {
        streamedMessageId = this.deps.pushMessage('assistant', draft.displayText, draft.grounding)
        if (this.deps.speechOutput.hasSpeakableContent(draft.speechText)) {
          const filter = new SafeCharacterStreamFilter()
          for (const delta of [...filter.push(draft.replyText), ...filter.flush()]) {
            commitSpeech(commitBuffer.push(delta))
          }
        }
      }
      streamedMessageFinalized = true
      commitSpeech(commitBuffer.flush())

      const completedSpeechStream = this.activeSpeechStream
      if (!completedSpeechStream) {
        this.completeSilentReply(turn.turnId, draft.emotionKey, draft.displayText)
        return {
          status: 'completed',
          turnId: turn.turnId,
          playbackCompleted: false,
          cleanupCompleted: true,
        }
      }

      completedSpeechStream.finish()
      await Promise.race([completedSpeechStream.completion, this.interruptionFor(turn.turnId)])
      if (this.activeSpeechStream === completedSpeechStream) this.activeSpeechStream = null
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null
      if (!this.isCurrentTurn(turn.turnId)) {
        return { status: 'cancelled', turnId: turn.turnId, attachmentDisposition }
      }

      failurePhase = 'cleanup'
      reportPhase('cleaning_up')
      await this.finishSpeechCleanup(turn.turnId)
      return {
        status: 'completed',
        turnId: turn.turnId,
        playbackCompleted: playbackStarted,
        cleanupCompleted: true,
      }
    } catch (error) {
      if (streamedMessageId && !streamedMessageFinalized) {
        this.deps.updateMessage(streamedMessageId, streamedDisplayText, undefined, false, true)
      }
      const failedSpeechStream = this.activeSpeechStream
      failedSpeechStream?.cancel('stream-failed')
      if (this.activeSpeechStream === failedSpeechStream) this.activeSpeechStream = null
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null
      const message = error instanceof Error ? error.message : String(error)
      if (
        (error instanceof ConversationInterruptedError && error.turnId === turn.turnId) ||
        !this.isCurrentTurn(turn.turnId)
      ) {
        return { status: 'cancelled', turnId: turn.turnId, attachmentDisposition }
      }
      if (error instanceof LlmCredentialMissingError || error instanceof LlmModelMissingError) {
        const reason =
          error instanceof LlmCredentialMissingError ? 'missing-credential' : 'model-missing'
        this.deps.handleLlmSetupRequired(turn.text, reason)
        this.deps.recordRuntimeEvent('LLM Setup Required', `turnId=${turn.turnId}`)
        await this.recoverToIdle(turn.turnId)
        return {
          status: 'failed',
          turnId: turn.turnId,
          phase: failurePhase,
          error: error.message,
          attachmentDisposition,
        }
      }
      if (error instanceof ConversationTurnFailureError) {
        const { failure } = error
        this.deps.recordRuntimeEvent(
          'Conversation Turn Failed',
          `provider=${failure.providerId ?? 'none'} turnId=${turn.turnId} code=${failure.code}`,
        )
        await this.recoverToIdle(turn.turnId)
        return {
          status: 'failed',
          turnId: turn.turnId,
          phase: failurePhase,
          error: failure.code,
          failure,
        }
      }
      if (['synthesis', 'playback'].includes(failurePhase)) {
        this.deps.recordRuntimeEvent(
          'synthesis_degraded',
          `turnId=${turn.turnId} message=${message}`,
        )
        await this.recoverToIdle(turn.turnId)
        return {
          status: 'completed',
          turnId: turn.turnId,
          playbackCompleted: false,
          cleanupCompleted: true,
        }
      }
      const invariantViolation =
        /(?:Character generation|Generation|Conversation Runtime|Conversation execution|Parallel playback) overlap|Parallel playback rejected/i.test(
          message,
        )
      this.deps.recordRuntimeEvent(
        invariantViolation ? 'conversation.invariant_violation' : `${failurePhase} Error`,
        `turnId=${turn.turnId} phase=${failurePhase} ${message}`,
      )
      if (!invariantViolation) this.deps.pushMessage('error', this.deps.formatUserError(message))
      await this.recoverToIdle(turn.turnId)
      return {
        status: 'failed',
        turnId: turn.turnId,
        phase: failurePhase,
        error: message,
        attachmentDisposition,
      }
    }
  }

  private async executeDebug(
    turn: AdmittedConversationTurn,
    reportPhase: (phase: ConversationExecutionPhase) => void,
  ): Promise<ConversationCompletionResult> {
    let failurePhase: 'synthesis' | 'playback' | 'cleanup' = 'synthesis'
    const emotionKey = turn.text || 'happy'
    const text = 'Тестирую полный поток речи Shio.'
    let stream: SpeechOutputStream | null = null
    try {
      this.deps.recordRuntimeEvent('Test Full Runtime Started', `turnId=${turn.turnId}`)
      this.prepareSpeech(emotionKey, `debug turnId=${turn.turnId}`)
      reportPhase('synthesizing')
      this.playbackTurnId = turn.turnId
      stream = this.deps.speechOutput.openStream(turn.turnId, deliveryIntent(emotionKey), {
        turnId: turn.turnId,
        onReady: (session) => {
          failurePhase = 'playback'
          reportPhase('playing')
          this.startSpeech(session, { emotionKey }, emotionKey, text)
        },
        onProgress: (progress) => {
          if (this.isCurrentTurn(turn.turnId)) this.deps.updateSpeechPlaybackProgress(progress)
        },
      })
      this.activeSpeechStream = stream
      stream.commit({
        id: `${turn.turnId}:speech:0`,
        turnId: turn.turnId,
        text,
        emotion: emotionKey,
        sequence: 0,
        boundary: 'final',
      })
      stream.finish()
      await Promise.race([stream.completion, this.interruptionFor(turn.turnId)])
      if (this.activeSpeechStream === stream) this.activeSpeechStream = null
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
      stream?.cancel('stream-failed')
      if (this.activeSpeechStream === stream) this.activeSpeechStream = null
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

  private isCurrentTurn(turnId: string): boolean {
    return this.activeTurnId === turnId
  }
  private interruptionFor(turnId: string): Promise<never> {
    return this.interruption?.turnId === turnId
      ? this.interruption.promise
      : new Promise<never>(() => undefined)
  }

  private enterAvatarMode(
    mode: 'idle' | 'listening' | 'thinking',
    emotionKey: string,
    status: ConversationStatus,
  ): void {
    this.deps.conversationState.transition({ status, mode, emotion: emotionKey })
    this.applyAvatarCharacterState()
    const thinkingImpulse =
      mode === 'thinking' && this.deps.presentation.triggerEarImpulse('thinking-entry')
    this.publishAvatarState({
      mode,
      emotionKey,
      earImpulse: thinkingImpulse ? 'thinking-entry' : undefined,
      earImpulseId: thinkingImpulse ? `thinking:${Date.now()}` : undefined,
    })
    this.deps.setStatus(status)
  }

  private prepareSpeech(emotionKey: string, eventDetail: string, replyText = ''): void {
    const conversationPresence = this.deps.conversationPresence.update({
      phase: 'startingSpeech',
      emotionKey,
      replyText,
    })
    this.deps.conversationState.transition({
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
    session: SpeechPlaybackSession,
    speech: SpeechReplyMetadata,
    fallbackEmotion: string,
    replyText = '',
  ): void {
    if (!this.isCurrentTurn(session.turnId))
      throw new Error(`Stale LipSync start turnId=${session.turnId}`)
    this.playbackStartedAt = session.startedAt
    this.recordLatency(session.turnId, 'playback_started', 'success')
    const emotionKey = speech.emotionKey ?? fallbackEmotion
    const embodiment = resolveEmotionEmbodimentProfile(emotionKey)
    const conversationPresence = this.deps.conversationPresence.update({
      phase: 'speaking',
      replyText,
      emotionKey,
    })
    this.deps.conversationState.transition({
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
      this.deps.presentation.triggerEarImpulse('reply-emphasis', session.playbackId)
    if (embodiment.id === 'surprised') this.deps.presentation.triggerReactionGesture('surprise')
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

  private async finishSpeechCleanup(turnId: string, extraEvent?: string): Promise<void> {
    if (!this.isCurrentTurn(turnId)) {
      console.debug(
        `[conversation] turnId=${turnId} stale-cleanup=ignored activeTurnId=${this.activeTurnId ?? 'none'}`,
      )
      return
    }
    this.setEmbodimentIntent(undefined)
    this.deps.presentation.stopLipSync(turnId)
    const finishing = this.deps.conversationPresence.update({ phase: 'finishingSpeech' })
    this.deps.conversationState.transition({
      status: 'idle',
      mode: 'idle',
      emotion: 'neutral',
      conversationPresence: finishing,
    })
    this.applyAvatarCharacterState({ stopLipSyncTurnId: turnId })
    const waiting = this.deps.conversationPresence.update({ phase: 'waiting' })
    this.deps.conversationState.setPresence(waiting)
    this.deps.updateSpeechPlaybackProgress(0)
    this.publishAvatarState({ mode: 'idle', emotionKey: 'neutral' })
    this.deps.setStatus('idle')
    this.publishRuntimeEvent('SpeechFinished', 'speech', `turnId=${turnId}`)
    this.recordLatency(turnId, 'playback_completed', 'success')
    this.deps.recordRuntimeEvent('Finished', `turnId=${turnId}`)
    this.deps.recordRuntimeEvent('Idle')
    if (extraEvent) this.deps.recordRuntimeEvent(extraEvent, `turnId=${turnId}`)
  }

  private async recoverToIdle(turnId: string): Promise<void> {
    if (!this.isCurrentTurn(turnId)) return
    this.setEmbodimentIntent(undefined)
    this.deps.presentation.stopLipSync(turnId)
    this.enterAvatarMode('idle', 'neutral', 'idle')
  }

  private completeSilentReply(turnId: string, emotionKey: string, replyText: string): void {
    this.setEmbodimentIntent(undefined)
    const listening = this.deps.isContinuousCaptureAlive()
    const status: ConversationStatus = listening ? 'listening' : 'idle'
    const mode: CharacterRuntimeMode = listening ? 'listening' : 'idle'
    const waiting = this.deps.conversationPresence.update({
      phase: 'waiting',
      replyText,
      emotionKey,
    })
    this.deps.conversationState.setPresence(waiting)
    this.deps.conversationState.transition({
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

  private applyAvatarCharacterState(
    options: Parameters<ConversationPresentationPort['applyCharacterState']>[1] = {},
  ): void {
    this.deps.presentation.applyCharacterState(this.deps.characterState.get(), options)
  }

  private publishAvatarState(state: ConversationAvatarProjection): void {
    this.deps.presentation.publishAvatarState(state, this.embodimentIntent)
  }

  private observeAdapterCancellation(
    adapter: 'LLM' | 'Speech',
    cancel: () => Promise<unknown>,
    turnId: string,
  ): void {
    try {
      const pending = cancel()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.recordCancellationFailure(adapter, turnId, error)
        })
      const group = this.cancellations.get(turnId) ?? new Set<Promise<void>>()
      group.add(pending)
      this.cancellations.set(turnId, group)
    } catch (error) {
      this.recordCancellationFailure(adapter, turnId, error)
    }
  }

  private recordCancellationFailure(adapter: string, turnId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    try {
      this.deps.recordRuntimeEvent(
        `${adapter} Cancellation Failed`,
        `turnId=${turnId} message=${message}`,
      )
    } catch (reportError) {
      console.error(`[conversation] ${adapter} cancellation reporting failed`, reportError)
    }
  }

  private setEmbodimentIntent(
    intent: CharacterEmbodimentIntent | undefined,
    context?: EmbodimentIntentContext,
  ): void {
    this.embodimentIntent = intent
    this.deps.presentation.setEmbodimentIntent(intent, context)
  }

  private publishRuntimeEvent(
    type: RuntimeEventType,
    category: RuntimeEventCategory,
    detail?: string,
  ): void {
    this.deps.events.publish({ type, category, source: 'renderer.conversationRuntime', detail })
  }

  private recordLatency(
    turnId: string,
    name: LatencyMilestoneName,
    status: 'started' | 'success' | 'failure' | 'cancelled',
    options: {
      at?: number
      ttsSegmentId?: string
      workerId?: string
      characters?: number
      words?: number
    } = {},
  ): void {
    const latency = window.api.latency
    if (!latency) return
    void latency
      .record({
        name,
        at: options.at ?? Date.now(),
        correlation: {
          turnId,
          requestId: characterRequestId(turnId),
          llmRound: 0,
          ttsSegmentId: options.ttsSegmentId,
        },
        status,
        metadata: {
          workerId: options.workerId,
          characters: options.characters,
          words: options.words,
        },
      })
      .catch((error) =>
        this.deps.recordRuntimeEvent(
          'Latency Telemetry Failed',
          error instanceof Error ? error.name : 'UNKNOWN',
        ),
      )
  }
}
