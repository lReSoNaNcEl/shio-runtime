import type { ExperienceEvent } from '../../shared/alive'
import type { CharacterEmbodimentIntent } from '../../shared/character-response'
import {
  characterRequestId,
  type SpeechSegment,
  StreamingSpeechSegmenter,
} from '../../shared/character-stream'
import type { ReplyGrounding } from '../../shared/conversation'
import {
  EMOTION_BOUNDARY_GAPS,
  type EmotionSegmentBoundary,
  type EmotionTextSegment,
  emotionRegistry,
} from '../../shared/emotion'
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
import { EmotionSpeechPipeline, type PreparedEmotionSpeechSegment } from './EmotionSpeechPipeline'
import type {
  SpeechOutputPort,
  SpeechPlaybackOptions,
  SpeechPlaybackSession,
} from './SpeechOutputPort'
import { StreamingSpeechPipeline } from './StreamingSpeechPipeline'
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

function toEmotionTextSegment(segment: SpeechSegment, index: number): EmotionTextSegment {
  const boundaryAfter: EmotionSegmentBoundary =
    segment.boundary === 'clause'
      ? 'clause'
      : /(?:\.\.\.|…)$/u.test(segment.text.trimEnd())
        ? 'expressive'
        : 'sentence'
  return {
    id: segment.id,
    index,
    emotion: emotionRegistry.normalize(segment.emotion),
    text: segment.text,
    boundaryAfter,
    targetMaxGapMs: EMOTION_BOUNDARY_GAPS[boundaryAfter],
  }
}

type SpeechReply = Awaited<ReturnType<Window['api']['tts']['synthesizeReply']>>
type SuccessfulSpeechReply = SpeechReply & { ok: true; audioBuffer: ArrayBuffer }

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
  pushMessage: (role: ChatMsg['role'], text: string, grounding?: ReplyGrounding) => string
  updateMessage: (id: string, text: string, grounding?: ReplyGrounding) => void
  formatUserError: (message: string) => string
  markAssistantMessageInterrupted: () => void
  setResponseInterruptionPending: (pending: boolean) => void
  recordRuntimeEvent: (label: string, detail?: string) => void
  /** Report a normalized Speech Adapter failure to the capabilities health component. */
  reportSpeechServiceError: (error: SerializedSpeechError) => void
  rememberSpeechMetadata: (speech: SpeechReply) => void
  updateSpeechPlaybackProgress: (progress: number) => void
  isContinuousCaptureAlive: () => boolean
  handleLlmSetupRequired: (userText: string, reason: 'missing-credential' | 'model-missing') => void
  reportExperience?: (event: ExperienceEvent) => void
}

export class ConversationRuntime {
  private activeTurnId: string | null = null
  private activePhase: ConversationExecutionPhase | null = null
  private playbackStartedAt: number | null = null
  private generationTurnId: string | null = null
  private synthesisTurnId: string | null = null
  private activeSynthesisWorkers = 0
  private playbackTurnId: string | null = null
  private activeEmotionPipeline: { cancel(): void } | null = null
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
    this.setEmbodimentIntent(undefined)
    this.activeEmotionPipeline?.cancel()
    this.activeTurnId = null
    this.activePhase = null
    this.playbackStartedAt = null
    // Settle the local execution before asking external adapters to cancel.
    // Adapter AbortErrors can therefore never win the local interruption race.
    interruption.reject(new ConversationInterruptedError(turnId, source))
    this.deps.speechOutput.stopCurrent(turnId, 'conversation-interrupted')
    this.deps.presentation.interruptLipSync(turnId)
    this.deps.markAssistantMessageInterrupted()
    const listening = this.deps.isContinuousCaptureAlive()
    const status: ConversationStatus = listening ? 'listening' : 'idle'
    const mode: CharacterRuntimeMode = listening ? 'listening' : 'idle'
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
      try {
        this.deps.presentation.triggerUserInterruption()
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
    this.deps.reportExperience?.({ type: 'conversation-interrupted', at: Date.now(), turnId })
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
      const streamSegmenter = new StreamingSpeechSegmenter(turn.turnId)
      let streamedDisplayText = ''
      let streamedMessageId: string | null = null
      let streamedSpeechPrepared = false
      let streamedPlaybackStarted = false
      let streamedSegmentCount = 0
      const streamingPipeline = new StreamingSpeechPipeline({
        turnId: turn.turnId,
        synthesize: (segment, signal) => {
          if (signal.aborted) throw signal.reason
          return this.runSynthesis(turn.turnId, () =>
            this.deps.speechOutput.synthesizeSegment(turn.turnId, segment),
          )
        },
        prepareAudio: (audioBuffer) => this.deps.speechOutput.prepare(audioBuffer),
        playPrepared: async (item, onStarted) => {
          this.rememberSpeech(item.speech, null)
          failurePhase = 'playback'
          await this.deps.speechOutput.playPrepared(item.audio, {
            turnId: turn.turnId,
            onReady: (session) => {
              if (!this.isCurrentTurn(turn.turnId))
                throw new Error(`Stale playback ready turnId=${turn.turnId}`)
              if (!streamedPlaybackStarted) {
                streamedPlaybackStarted = true
                reportPhase('playing')
              }
              this.startSpeech(session, item.speech, item.segment.emotion, item.segment.text)
            },
            onProgress: (progress) => {
              if (this.isCurrentTurn(turn.turnId)) this.deps.updateSpeechPlaybackProgress(progress)
            },
            onStarted,
          })
        },
        isCurrentTurn: () => this.isCurrentTurn(turn.turnId),
        recordEvent: (label, detail) => this.deps.recordRuntimeEvent(label, detail),
        recordTiming: (event) => {
          const options = {
            at: event.at,
            ttsSegmentId: event.segment.id,
            workerId: event.workerId,
            characters: event.segment.text.length,
            words: event.segment.text.trim().split(/\s+/u).filter(Boolean).length,
          }
          this.recordLatency(turn.turnId, event.name, 'success', options)
          if (event.name === 'audio_ready' && event.segment.index === 0) {
            this.recordLatency(turn.turnId, 'first_audio_ready', 'success', options)
          }
        },
      })
      this.activeEmotionPipeline = streamingPipeline
      const streamingExecution = streamingPipeline.execute()
      void streamingExecution.catch(() => undefined)
      const enqueueSpeechSegments = (
        segments: ReturnType<StreamingSpeechSegmenter['push']>,
      ): void => {
        for (const segment of segments) {
          if (streamedSegmentCount === 0) {
            this.recordLatency(turn.turnId, 'llm_first_sentence', 'success')
          }
          if (!streamedSpeechPrepared) {
            streamedSpeechPrepared = true
            failurePhase = 'synthesis'
            this.playbackTurnId = turn.turnId
            this.prepareSpeech(segment.emotion, `stream turnId=${turn.turnId}`, streamedDisplayText)
            reportPhase('synthesizing')
          }
          streamingPipeline.enqueue(toEmotionTextSegment(segment, streamedSegmentCount))
          streamedSegmentCount += 1
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
            if (event.type !== 'text-delta' || !this.isCurrentTurn(turn.turnId)) return
            streamedDisplayText += event.delta.text
            if (!streamedMessageId && streamedDisplayText.trim()) {
              streamedMessageId = this.deps.pushMessage('assistant', streamedDisplayText)
            } else if (streamedMessageId) {
              this.deps.updateMessage(streamedMessageId, streamedDisplayText)
            }
            enqueueSpeechSegments(streamSegmenter.push(event.delta))
          },
          turn.source === 'autonomous_initiative' ? 'autonomous' : 'user',
        ),
      )
      if (!this.isCurrentTurn(turn.turnId)) return { status: 'cancelled', turnId: turn.turnId }

      this.setEmbodimentIntent(draft.embodimentIntent)

      this.publishRuntimeEvent('SentenceGenerated', 'speech', `turnId=${turn.turnId}`)
      const generatedPresence = this.deps.conversationPresence.update({
        phase: 'preparingReply',
        userText: turn.text,
        replyText: draft.displayText,
        emotionKey: draft.emotionKey,
      })
      this.deps.conversationState.setPresence(generatedPresence)
      if (streamedMessageId) {
        this.deps.updateMessage(streamedMessageId, draft.displayText, draft.grounding)
        enqueueSpeechSegments(streamSegmenter.flush())
        streamingPipeline.close()
        await Promise.race([streamingExecution, this.interruptionFor(turn.turnId)])
        if (this.activeEmotionPipeline === streamingPipeline) this.activeEmotionPipeline = null
        if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null
        if (!this.isCurrentTurn(turn.turnId)) return { status: 'cancelled', turnId: turn.turnId }
        reportPhase('cleaning_up')
        if (streamedSpeechPrepared) await this.finishSpeechCleanup(turn.turnId)
        else this.completeSilentReply(turn.turnId, draft.emotionKey, draft.displayText)
        return {
          status: 'completed',
          turnId: turn.turnId,
          playbackCompleted: streamedPlaybackStarted,
          cleanupCompleted: true,
        }
      }

      streamingPipeline.cancel()
      await streamingExecution.catch(() => undefined)
      if (this.activeEmotionPipeline === streamingPipeline) this.activeEmotionPipeline = null
      this.deps.pushMessage('assistant', draft.displayText, draft.grounding)

      if (!this.deps.speechOutput.hasSpeakableContent(draft.speechText)) {
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
          this.deps.speechOutput.synthesizeSegment(turn.turnId, segment),
        )
        this.rememberSpeech(speech, null)
        failurePhase = 'playback'
        reportPhase('playing')
        await Promise.race([
          this.deps.speechOutput.play(speech.audioBuffer, {
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
                this.deps.speechOutput.synthesizeSegment(turn.turnId, segment),
              )
            } catch (error) {
              synthesisFailure = error
              throw error
            }
          },
          prepareAudio: (audioBuffer) => this.deps.speechOutput.prepare(audioBuffer),
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
      this.activeEmotionPipeline?.cancel()
      this.activeEmotionPipeline = null
      if (this.playbackTurnId === turn.turnId) this.playbackTurnId = null
      const message = error instanceof Error ? error.message : String(error)
      if (
        (error instanceof ConversationInterruptedError && error.turnId === turn.turnId) ||
        !this.isCurrentTurn(turn.turnId)
      ) {
        return { status: 'cancelled', turnId: turn.turnId }
      }
      if (error instanceof LlmCredentialMissingError || error instanceof LlmModelMissingError) {
        const reason =
          error instanceof LlmCredentialMissingError ? 'missing-credential' : 'model-missing'
        this.deps.handleLlmSetupRequired(turn.text, reason)
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
      if (
        isSpeechServiceError(error) &&
        error.operation === 'synthesis' &&
        error.code === 'CANCELLED'
      ) {
        this.deps.recordRuntimeEvent('synthesis_cancelled', `turnId=${turn.turnId}`)
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
        this.deps.speechOutput.createDebugSpeechTurn(turn.turnId, emotionKey),
      )
      if (!this.isCurrentTurn(turn.turnId)) return { status: 'cancelled', turnId: turn.turnId }
      this.rememberSpeech(speechTurn.speech, speechTurn.ttsLatencyText)

      failurePhase = 'playback'
      reportPhase('playing')
      this.playbackTurnId = turn.turnId
      await Promise.race([
        this.deps.speechOutput.play(speechTurn.speech.audioBuffer, {
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
    if (this.synthesisTurnId && this.synthesisTurnId !== turnId)
      throw new Error(
        `Synthesis overlap: activeTurnId=${this.synthesisTurnId} requestedTurnId=${turnId}`,
      )
    if (this.activeSynthesisWorkers >= 2)
      throw new Error(`Synthesis worker limit exceeded turnId=${turnId}`)
    this.synthesisTurnId = turnId
    this.activeSynthesisWorkers += 1
    console.debug(
      `[conversation] turnId=${turnId} synthesis=started workers=${this.activeSynthesisWorkers}`,
    )
    try {
      const result = await Promise.race([operation(), this.interruptionFor(turnId)])
      if (!this.isCurrentTurn(turnId)) throw new Error(`Stale synthesis result turnId=${turnId}`)
      console.debug(`[conversation] turnId=${turnId} synthesis=completed`)
      return result
    } finally {
      this.activeSynthesisWorkers = Math.max(0, this.activeSynthesisWorkers - 1)
      if (this.synthesisTurnId === turnId && this.activeSynthesisWorkers === 0)
        this.synthesisTurnId = null
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
    speech: SuccessfulSpeechReply,
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

  private async playPreparedEmotionSegment(
    turnId: string,
    item: PreparedEmotionSpeechSegment,
    onReady: SpeechPlaybackOptions['onReady'],
    onProgress: (progress: number) => void,
    onStarted: () => void,
  ): Promise<void> {
    await this.deps.speechOutput.playPrepared(item.audio, {
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

  private rememberSpeech(speech: SpeechReply, latencyText: string | null): void {
    this.deps.rememberSpeechMetadata(speech)
    if (latencyText) this.deps.pushMessage('meta', latencyText)
  }

  private applyAvatarCharacterState(
    options: Parameters<ConversationPresentationPort['applyCharacterState']>[1] = {},
  ): void {
    this.deps.presentation.applyCharacterState(this.deps.characterState.get(), options)
  }

  private publishAvatarState(state: ConversationAvatarProjection): void {
    this.deps.presentation.publishAvatarState(state, this.embodimentIntent)
  }

  private setEmbodimentIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.embodimentIntent = intent
    this.deps.presentation.setEmbodimentIntent(intent)
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
