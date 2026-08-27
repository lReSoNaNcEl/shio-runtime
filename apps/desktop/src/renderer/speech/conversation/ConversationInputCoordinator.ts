import type { FastBrainAttentionDecision } from '../../../shared/alive'
import type {
  CharacterState,
  RuntimeEventCategory,
  RuntimeEventType,
} from '../../../shared/runtime'
import type { SerializedSpeechError } from '../../../shared/speech'
import type { MicrophoneDeviceService } from '../../audio/MicrophoneDeviceService'
import type { MicrophoneGateController } from '../../audio/MicrophoneGateController'
import { isDefaultMicrophone, type StreamingModeId } from '../../audio/microphoneGateTypes'
import { semanticEarTuning } from '../../avatar/tuning/motionTuning'
import type { ChatMsg, ControllerState } from '../../controller/contracts'
import { AttentionEngine } from '../../conversation/admission/AttentionEngine'
import {
  BacklogSelector,
  type BacklogSelectorDiagnostics,
} from '../../conversation/admission/BacklogSelector'
import {
  ConversationAdmissionCoordinator,
  type ConversationAdmissionOutcome,
} from '../../conversation/admission/ConversationAdmissionCoordinator'
import { RuleGate } from '../../conversation/admission/RuleGate'
import { observeRendererPromise } from '../../reliability/observePromise'
import type { ConversationPresentationPort } from '../../runtime/ConversationPresentationPort'
import type { ConversationRuntime } from '../../runtime/ConversationRuntime'
import type {
  ContinuousPartialSpeech,
  ContinuousRecognizedSpeech,
  SpeechInputRuntime,
} from '../../runtime/SpeechInputRuntime'
import { BargeInPolicy } from '../continuous-listening/BargeInPolicy'
import {
  CORRECTION_PATTERN,
  isExplicitBargeInPhrase,
  textSimilarity,
} from '../continuous-listening/textAnalysis'
import {
  backlogTuning,
  bargeInTuning,
  defaultContinuousListeningSettings,
} from '../continuous-listening/tuning'
import type {
  AdmittedConversationTurn,
  BufferedUtterance,
  ChatSubmissionResult,
  ContinuousListeningProjection,
  ContinuousListeningRuntimeProjection,
  ContinuousListeningSettings,
  ConversationCompletionResult,
  ConversationExecutionPhase,
  ConversationInput,
  UtteranceChunk,
} from '../continuous-listening/types'
import { UtteranceBacklog } from '../continuous-listening/UtteranceBacklog'
import { UtteranceChunkBuilder } from '../continuous-listening/UtteranceChunkBuilder'

const QUESTION_PATTERN =
  /\?|(?:^|\s)(?:кто|что|где|когда|зачем|почему|как|можешь|скажешь|думаешь)(?:$|[\s,.!?])/iu

type ContinuousAttentionDecision = ReturnType<AttentionEngine['evaluate']>

export function resolveContinuousAttention(
  fallback: ContinuousAttentionDecision,
  fastBrain: FastBrainAttentionDecision,
): ContinuousAttentionDecision {
  if (fallback.shouldAttend && !fastBrain.shouldAttend) {
    return {
      ...fallback,
      reasons: [
        ...fallback.reasons,
        `fast_brain:${fastBrain.source}:${fastBrain.reason}:local_admit_preserved`,
      ],
    }
  }
  return {
    shouldAttend: fastBrain.shouldAttend,
    score: Math.round(fastBrain.confidence * 100),
    threshold: 50,
    reasons: [`fast_brain:${fastBrain.source}:${fastBrain.reason}`],
    directAddress: fallback.directAddress,
  }
}

export interface ConversationInputCoordinatorDependencies {
  speechInputRuntime: SpeechInputRuntime
  conversationRuntime: ConversationRuntime
  microphoneGate: MicrophoneGateController
  presentation: ConversationPresentationPort

  getControllerState(): ControllerState
  getCharacterState(): CharacterState

  patchControllerState(patch: Partial<ControllerState>): void
  pushMessage(role: ChatMsg['role'], text: string): void

  recordRuntimeEvent(label: string, detail?: string): void
  publishRuntimeEvent(type: RuntimeEventType, category: RuntimeEventCategory, detail?: string): void

  getConfig(): ReturnType<Window['api']['config']['get']>
  saveConfig(
    patch: Parameters<Window['api']['config']['save']>[0],
  ): ReturnType<Window['api']['config']['save']>
  arbitrateBacklog(
    request: Parameters<Window['api']['llm']['arbitrateBacklog']>[0],
  ): ReturnType<Window['api']['llm']['arbitrateBacklog']>
  evaluateAttention(
    request: Parameters<Window['api']['alive']['evaluateAttention']>[0],
  ): ReturnType<Window['api']['alive']['evaluateAttention']>
  cancelAttention(
    utteranceId: Parameters<Window['api']['alive']['cancelAttention']>[0],
  ): ReturnType<Window['api']['alive']['cancelAttention']>
  normalizeMicrophoneFailure(
    error: unknown,
  ): ReturnType<MicrophoneDeviceService['normalizeFailure']>
  getMicrophoneAccessFailedMessage(): string

  createTurnId(prefix: string): string
}

export class ConversationInputCoordinator {
  private chunkBuilder = new UtteranceChunkBuilder()
  private bargeInPolicy = new BargeInPolicy()
  private bargeInSegments = new Set<string>()
  private attentionEngine = new AttentionEngine()
  private ruleGate = new RuleGate()
  private continuousSettings: ContinuousListeningSettings = {
    ...defaultContinuousListeningSettings,
  }
  private handledUtteranceIds = new Set<string>()
  private lastContinuousReplyAt: number | null = null
  private streamingSessionId: string | null = null
  private utteranceBacklog = new UtteranceBacklog()
  private backlogSelector: BacklogSelector
  private conversationAdmission: ConversationAdmissionCoordinator
  private desiredContinuousListening = false
  private conversationBoundaryAt = 0
  private conversationSessionResetPending = false
  private attentionGeneration = 0
  private pendingAttentionUtteranceIds = new Set<string>()
  private continuousCommandGeneration = 0

  constructor(private readonly dependencies: ConversationInputCoordinatorDependencies) {
    this.backlogSelector = new BacklogSelector(async (items, backlogVersion, config) => {
      const response = await this.dependencies.arbitrateBacklog({
        items,
        backlogVersion,
        providerId: config.providerId,
        model: config.model,
      })
      if (!response.ok || !response.result)
        throw new Error(response.error ?? 'Backlog arbitration failed')
      return response.result
    })
    this.conversationAdmission = new ConversationAdmissionCoordinator(
      (attempt, reportPhase) => this.runConversationAttempt(attempt, reportPhase),
      this.utteranceBacklog,
      this.backlogSelector,
      (error, attempt) =>
        this.dependencies.recordRuntimeEvent(
          'Conversation Admission Error',
          `${attempt.turnId}:${String(error)}`,
        ),
    )
  }

  async admitText(text: string, screenContextId?: string): Promise<ChatSubmissionResult> {
    const trimmed = text.trim()
    if (!trimmed) return { status: 'cancelled' }
    const result = await this.conversationAdmission.admitExplicit({
      turnId: this.dependencies.createTurnId('text'),
      text: trimmed,
      source: 'text_chat',
      screenContextId,
      createdAt: this.nextConversationTimestamp(),
      semanticCues: {
        directAddress: false,
        question: QUESTION_PATTERN.test(trimmed),
        recognitionUncertain: false,
      },
    })
    if (result.status === 'completed') return { status: 'completed' }
    if (result.status === 'cancelled') return { status: 'cancelled' }
    return {
      status: 'failed',
      failure: result.failure ?? {
        domain: screenContextId ? 'screen-context' : 'llm',
        code: 'UNKNOWN',
        attachmentDisposition: screenContextId ? 'retained' : 'released',
        retrySameRequest: false,
        canResubmitWithoutImage: Boolean(screenContextId),
      },
    }
  }

  async admitPushToTalk(text: string): Promise<void> {
    await this.conversationAdmission.admit({
      turnId: this.dependencies.createTurnId('manual-speech'),
      text,
      source: 'push_to_talk',
      createdAt: this.nextConversationTimestamp(),
      semanticCues: {
        directAddress: false,
        question: QUESTION_PATTERN.test(text),
        recognitionUncertain: false,
      },
    })
  }

  async admitDebug(emotionKey: string): Promise<ConversationAdmissionOutcome> {
    return this.conversationAdmission.admit({
      turnId: this.dependencies.createTurnId('debug'),
      text: emotionKey,
      source: 'debug',
      createdAt: this.nextConversationTimestamp(),
    })
  }

  async admitAutonomousInitiative(
    topic: string,
  ): Promise<'completed' | 'cancelled' | 'failed' | 'suppressed-busy'> {
    const trimmed = topic.trim().slice(0, 300)
    if (!trimmed) return 'failed'
    const result = await this.conversationAdmission.admitWithResult({
      turnId: this.dependencies.createTurnId('initiative'),
      text: trimmed,
      source: 'autonomous_initiative',
      createdAt: this.nextConversationTimestamp(),
    })
    if (result.outcome === 'ignored_busy') return 'suppressed-busy'
    if (!result.completion) return 'failed'
    return result.completion.status
  }

  resetConversationSession(): void {
    this.cancelPendingAttention()
    this.conversationBoundaryAt = Date.now()
    this.conversationSessionResetPending = true
    this.chunkBuilder = new UtteranceChunkBuilder()
    this.bargeInPolicy.reset()
    this.bargeInSegments.clear()
    this.lastContinuousReplyAt = null
    this.conversationAdmission.resetStreamingSession()
  }

  completeConversationSessionReset(): void {
    this.conversationSessionResetPending = false
  }

  async applyContinuousSettings(
    settings: ContinuousListeningSettings,
    persist = true,
  ): Promise<void> {
    const generation = ++this.continuousCommandGeneration
    this.desiredContinuousListening = settings.enabled
    this.continuousSettings = { ...settings, enabled: false }
    this.patchContinuousProjection({
      ...this.dependencies.getControllerState().continuousListening,
      desired: settings.enabled,
    })
    if (!settings.enabled) {
      this.cancelPendingAttention()
      this.conversationAdmission.setContinuousEnabled(false)
      this.bargeInPolicy.reset()
      this.bargeInSegments.clear()
      this.streamingSessionId = null
      await this.dependencies.speechInputRuntime.setContinuousListening(false)
      if (generation !== this.continuousCommandGeneration) return
      if (persist) await this.persistContinuousTuning(settings)
      return
    }
    this.conversationAdmission.setContinuousEnabled(false)
    const config = await this.dependencies.getConfig()
    if (generation !== this.continuousCommandGeneration) return
    this.conversationAdmission.configureSelector(config.llm.roles.backlogSelector)
    try {
      await this.dependencies.speechInputRuntime.setContinuousListening(
        settings.enabled,
        (recognized) => this.handleContinuousFinal(recognized),
        (partial) => this.handleContinuousPartial(partial),
        () => {
          observeRendererPromise(
            this.handleContinuousDeviceLost(),
            'recover from continuous microphone loss',
          )
        },
      )
      if (generation !== this.continuousCommandGeneration) return
      this.continuousSettings.enabled = settings.enabled
      this.conversationAdmission.setContinuousEnabled(settings.enabled)
    } catch (error) {
      if (generation !== this.continuousCommandGeneration) return
      this.continuousSettings.enabled = false
      this.conversationAdmission.setContinuousEnabled(false)
      throw error
    }
    if (persist) await this.persistContinuousTuning(settings)
  }

  async toggleContinuousListening(): Promise<void> {
    const state = this.dependencies.getControllerState()
    if (state.microphoneGate.status !== 'closed') return
    if (state.continuousListening.desired) {
      await this.applyContinuousSettings({ ...this.continuousSettings, enabled: false })
      return
    }
    await this.requestStreamingStart('default')
  }

  handleStreamingServiceLost(_error: SerializedSpeechError): void {
    this.cancelPendingAttention()
    this.continuousSettings.enabled = false
    this.conversationAdmission.setContinuousEnabled(false)
    this.chunkBuilder = new UtteranceChunkBuilder()
    this.bargeInPolicy.reset()
    this.bargeInSegments.clear()
    this.streamingSessionId = null
    this.dependencies.recordRuntimeEvent(
      'Streaming Service Lost Teardown',
      `desired=${this.desiredContinuousListening}`,
    )
  }

  handleContinuousRuntimeProjection(projection: ContinuousListeningRuntimeProjection): void {
    this.patchContinuousProjection({
      ...projection,
      desired: this.desiredContinuousListening,
    })
  }

  async retryContinuousListening(): Promise<void> {
    const projection = this.dependencies.getControllerState().continuousListening
    if (!projection.desired || projection.transport !== 'failed') return
    if (
      projection.failure?.domain === 'microphone' ||
      projection.failure?.domain === 'permission'
    ) {
      await this.requestStreamingStart('default')
      return
    }
    await this.startStreaming('default')
  }

  isContinuousEnabled(): boolean {
    return this.continuousSettings.enabled
  }

  getSettings(): Readonly<ContinuousListeningSettings> {
    return this.continuousSettings
  }

  getBacklogDiagnostics(): BacklogSelectorDiagnostics {
    return this.backlogSelector.getDiagnostics()
  }

  dispose(): void {
    this.cancelPendingAttention()
  }

  private async requestStreamingStart(modeId: StreamingModeId): Promise<void> {
    const result = await this.dependencies.microphoneGate.request(
      { type: 'start-streaming', modeId },
      'not-configured',
    )
    if (result.status !== 'confirmed') {
      this.dependencies.recordRuntimeEvent('Streaming Start Blocked', modeId)
      return
    }
    this.dependencies.speechInputRuntime.setMicrophone(
      isDefaultMicrophone(result.deviceId) ? '' : result.deviceId,
    )
    await this.startStreaming(modeId)
  }

  private async startStreaming(modeId: StreamingModeId): Promise<void> {
    try {
      await this.applyContinuousSettings({
        ...this.continuousSettings,
        enabled: true,
      })
    } catch (error) {
      const projection = this.dependencies.getControllerState().continuousListening
      if (!projection.desired) return
      const failure = this.dependencies.normalizeMicrophoneFailure(error)
      this.dependencies.recordRuntimeEvent('Streaming Runtime Start Failed', failure.reason)
      if (
        projection.failure?.domain !== 'microphone' &&
        projection.failure?.domain !== 'permission'
      ) {
        return
      }
      const result = await this.dependencies.microphoneGate.request(
        { type: 'start-streaming', modeId },
        'runtime-start-failed',
        failure.reason,
      )
      if (result.status === 'confirmed') {
        this.dependencies.speechInputRuntime.setMicrophone(
          isDefaultMicrophone(result.deviceId) ? '' : result.deviceId,
        )
        await this.startStreaming(modeId)
      }
    }
  }

  private async handleContinuousDeviceLost(): Promise<void> {
    if (!this.continuousSettings.enabled) return
    const modeId: StreamingModeId = 'default'
    this.dependencies.recordRuntimeEvent('Streaming Microphone Lost', modeId)
    const failure = this.dependencies.getControllerState().continuousListening.failure
    const generation = ++this.continuousCommandGeneration
    this.continuousSettings.enabled = false
    this.conversationAdmission.setContinuousEnabled(false)
    await this.dependencies.speechInputRuntime.setContinuousListening(false)
    if (generation !== this.continuousCommandGeneration) return
    this.patchContinuousProjection({
      desired: true,
      transport: 'failed',
      activity: 'idle',
      microphoneCaptured: false,
      failure: failure ?? { domain: 'microphone', code: 'DEVICE_LOST' },
    })
    const result = await this.dependencies.microphoneGate.request(
      { type: 'start-streaming', modeId },
      'active-device-lost',
    )
    if (result.status === 'confirmed') {
      this.dependencies.speechInputRuntime.setMicrophone(
        isDefaultMicrophone(result.deviceId) ? '' : result.deviceId,
      )
      await this.startStreaming(modeId)
    }
  }

  private patchContinuousProjection(projection: ContinuousListeningProjection): void {
    this.dependencies.patchControllerState({ continuousListening: projection })
  }

  private async persistContinuousTuning(settings: ContinuousListeningSettings): Promise<void> {
    await this.dependencies.saveConfig({
      continuousListeningReplyCooldownMs: String(settings.replyCooldownMs),
      continuousListeningFollowUpWindowMs: String(settings.followUpWindowMs),
      continuousListeningCuriosityChance: String(settings.curiosityChance),
    })
  }

  private async handleContinuousFinal(recognized: ContinuousRecognizedSpeech): Promise<void> {
    this.ensureStreamingSession(recognized.streamingSessionId)
    const segmentKey = `${recognized.streamingSessionId}:${recognized.segmentId}`
    const triggeredBargeIn = this.bargeInSegments.delete(segmentKey)
    const chunk = this.chunkBuilder.pushFinal(recognized.text, recognized.confidence, {
      streamingSessionId: recognized.streamingSessionId,
      segmentId: recognized.segmentId,
      capturedDuringPlayback: recognized.capturedDuringPlayback,
      triggeredBargeIn,
    })
    if (!chunk) return
    this.dependencies.recordRuntimeEvent('Utterance Completed', chunk.completionReason)
    if (triggeredBargeIn) {
      this.dependencies.recordRuntimeEvent('Barge In Utterance Finalized', `utterance=${chunk.id}`)
      this.dependencies.publishRuntimeEvent(
        'BargeInUtteranceFinalized',
        'speech',
        `utterance=${chunk.id}`,
      )
    }
    await this.processContinuousChunk(chunk)
  }

  private handleContinuousPartial(partial: ContinuousPartialSpeech): void {
    this.ensureStreamingSession(partial.streamingSessionId)
    this.chunkBuilder.pushPartial(partial.text)
    const response = this.dependencies.conversationRuntime.getActiveResponseSnapshot()
    if (!response.turnId || (response.phase !== 'synthesizing' && response.phase !== 'playing')) {
      return
    }

    const now = performance.now()
    const currentReply =
      [...this.dependencies.getControllerState().messages]
        .reverse()
        .find((message) => message.role === 'assistant')?.text ?? ''
    const similarity = textSimilarity(partial.text, currentReply)
    const likelySelfEcho =
      partial.capturedDuringPlayback &&
      !isExplicitBargeInPhrase(partial.text) &&
      similarity >= bargeInTuning.selfEchoSimilarityThreshold
    const detail =
      `duration=${Math.round(partial.speechDurationMs)}ms ` +
      `confidence=${partial.confidence?.toFixed(2) ?? 'n/a'} turn=${response.turnId}`
    this.dependencies.recordRuntimeEvent('Barge In Candidate', detail)
    this.dependencies.publishRuntimeEvent('BargeInCandidate', 'speech', detail)

    const decision = this.bargeInPolicy.evaluate({
      now,
      activeResponseId: response.turnId,
      responsePhase: response.phase,
      partialText: partial.text,
      speechDurationMs: partial.speechDurationMs,
      confidence: partial.confidence,
      capturedDuringPlayback: partial.capturedDuringPlayback,
      playbackStartedAt: response.playbackStartedAt,
      responseInterruptionPending:
        this.dependencies.getControllerState().responseInterruptionPending,
      likelySelfEcho,
    })
    if (decision.type === 'ignore') {
      const rejectedDetail =
        decision.reason === 'self-echo'
          ? `reason=self-echo similarity=${similarity.toFixed(2)} turn=${response.turnId}`
          : `reason=${decision.reason} turn=${response.turnId}`
      this.dependencies.recordRuntimeEvent('Barge In Rejected', rejectedDetail)
      this.dependencies.publishRuntimeEvent('BargeInRejected', 'speech', rejectedDetail)
      return
    }

    this.bargeInPolicy.markTriggered(decision.responseId, now)
    const segmentKey = `${partial.streamingSessionId}:${partial.segmentId}`
    this.bargeInSegments.add(segmentKey)
    if (this.bargeInSegments.size > 64) {
      const oldest = this.bargeInSegments.values().next().value
      if (oldest) this.bargeInSegments.delete(oldest)
    }
    const acceptedDetail = `turn=${decision.responseId} segment=${partial.segmentId}`
    this.dependencies.recordRuntimeEvent('Barge In Accepted', acceptedDetail)
    this.dependencies.publishRuntimeEvent('BargeInAccepted', 'speech', acceptedDetail)
    observeRendererPromise(
      this.dependencies.conversationRuntime
        .interruptCurrentResponse('voice-barge-in')
        .then((interrupted) => {
          if (!interrupted) this.bargeInSegments.delete(segmentKey)
        }),
      'interrupt response for voice barge-in',
      () => this.bargeInSegments.delete(segmentKey),
    )
  }

  private ensureStreamingSession(streamingSessionId: string): void {
    if (this.streamingSessionId === streamingSessionId) return
    if (this.streamingSessionId) {
      this.cancelPendingAttention()
      this.conversationAdmission.resetStreamingSession()
    }
    this.streamingSessionId = streamingSessionId
    this.bargeInPolicy.reset()
    this.bargeInSegments.clear()
  }

  private async processContinuousChunk(chunk: UtteranceChunk): Promise<void> {
    const now = Date.now()
    const sinceReply =
      this.lastContinuousReplyAt === null
        ? Number.POSITIVE_INFINITY
        : now - this.lastContinuousReplyAt
    const cooldownActive = sinceReply < this.continuousSettings.replyCooldownMs
    const followUpWindow = sinceReply < this.continuousSettings.followUpWindowMs
    const state = this.dependencies.getControllerState()
    const isSpeaking = state.status === 'speaking'
    const conversationBusy = this.conversationAdmission.isBusy() || state.status !== 'idle'
    const fallbackAttention = this.attentionEngine.evaluate(chunk, {
      isSpeaking,
      cooldownActive,
      recentConversation: followUpWindow,
      followUpWindow,
      curiosityChance: this.continuousSettings.curiosityChance,
    })
    let attention = fallbackAttention
    const attentionGeneration = this.attentionGeneration
    this.pendingAttentionUtteranceIds.add(chunk.id)
    try {
      const fastBrain = await this.dependencies.evaluateAttention({
        utteranceId: chunk.id,
        directAddress: fallbackAttention.directAddress,
        question: QUESTION_PATTERN.test(chunk.text),
        recentConversation: followUpWindow,
        speaking: isSpeaking,
        cooldownActive,
      })
      if (
        attentionGeneration !== this.attentionGeneration ||
        this.streamingSessionId !== chunk.streamingSessionId ||
        !this.continuousSettings.enabled
      ) {
        return
      }
      attention = resolveContinuousAttention(fallbackAttention, fastBrain)
    } catch (error) {
      if (attentionGeneration !== this.attentionGeneration) return
      this.dependencies.recordRuntimeEvent(
        'Fast Brain Fallback',
        error instanceof Error ? error.name : 'UNKNOWN',
      )
    } finally {
      this.pendingAttentionUtteranceIds.delete(chunk.id)
    }
    this.dependencies.recordRuntimeEvent(
      attention.shouldAttend ? 'Attention Accepted' : 'Attention Rejected',
      `${attention.score}/${Number.isFinite(attention.threshold) ? attention.threshold : '∞'} ${attention.reasons.join(',')}`,
    )
    const decision = chunk.triggeredBargeIn
      ? { type: 'llm' as const, userText: chunk.text, reason: 'voice_barge_in' }
      : this.ruleGate.decide(chunk, attention, {
          isSpeaking,
          conversationBusy,
          cooldownActive,
          alreadyHandled: this.handledUtteranceIds.has(chunk.id),
        })
    this.dependencies.recordRuntimeEvent(
      'Rule Gate Decision',
      `${decision.type}:${decision.reason}`,
    )

    if (decision.type === 'ignore') {
      this.rememberHandledUtterance(chunk.id)
      return
    }

    const input: ConversationInput = {
      turnId: chunk.id,
      text: decision.userText,
      source: 'continuous_listening',
      createdAt: chunk.completedAt,
      streamingSessionId: chunk.streamingSessionId,
      utteranceIds: [chunk.id],
      triggeredBargeIn: Boolean(chunk.triggeredBargeIn),
      semanticCues: {
        directAddress: attention.directAddress,
        question: QUESTION_PATTERN.test(decision.userText),
        recognitionUncertain:
          chunk.confidence !== undefined &&
          chunk.confidence < semanticEarTuning.recognitionUncertainThreshold,
      },
    }
    const buffered = this.createBufferedUtterance(
      chunk,
      attention,
      conversationBusy,
      followUpWindow,
    )
    if (buffered.likelySelfEcho) {
      this.rememberHandledUtterance(chunk.id)
      this.dependencies.recordRuntimeEvent('Continuous Self Echo Suppressed', chunk.id)
      return
    }
    const admission = await this.conversationAdmission.admit(input, buffered)
    if (admission === 'ignored_busy') this.rememberHandledUtterance(chunk.id)
  }

  private cancelPendingAttention(): void {
    this.attentionGeneration += 1
    for (const utteranceId of this.pendingAttentionUtteranceIds) {
      observeRendererPromise(
        this.dependencies.cancelAttention(utteranceId),
        'cancel Fast Brain attention request',
      )
    }
    this.pendingAttentionUtteranceIds.clear()
  }

  private createBufferedUtterance(
    chunk: UtteranceChunk,
    attention: ReturnType<AttentionEngine['evaluate']>,
    conversationBusy: boolean,
    followUpWindow: boolean,
  ): BufferedUtterance {
    const text = chunk.text.trim()
    const question = QUESTION_PATTERN.test(text)
    const correctionHint = CORRECTION_PATTERN.test(text)
    const currentReply =
      [...this.dependencies.getControllerState().messages]
        .reverse()
        .find((message) => message.role === 'assistant')?.text ?? ''
    const likelySelfEcho = Boolean(
      !chunk.triggeredBargeIn &&
        chunk.capturedDuringPlayback &&
        !correctionHint &&
        textSimilarity(text, currentReply) >= bargeInTuning.selfEchoSimilarityThreshold,
    )
    const priorityClass: BufferedUtterance['priorityClass'] = chunk.triggeredBargeIn
      ? 'P0'
      : correctionHint
        ? 'P0'
        : attention.directAddress && question
          ? 'P1'
          : attention.directAddress || followUpWindow
            ? 'P2'
            : 'P3'
    const ttl = chunk.triggeredBargeIn
      ? backlogTuning.ttlMs.correction
      : correctionHint
        ? backlogTuning.ttlMs.correction
        : attention.directAddress
          ? backlogTuning.ttlMs.direct
          : followUpWindow
            ? backlogTuning.ttlMs.followUp
            : backlogTuning.ttlMs.nonDirect
    return {
      id: chunk.id,
      text,
      createdAt: chunk.completedAt,
      expiresAt: chunk.completedAt + ttl,
      streamingSessionId: chunk.streamingSessionId ?? 'unknown',
      segmentId: chunk.segmentId,
      directAddress: attention.directAddress,
      question,
      correctionHint,
      followUpHint: followUpWindow,
      attentionScore: attention.score,
      capturedWhileShioBusy: conversationBusy,
      capturedDuringPlayback: Boolean(chunk.capturedDuringPlayback),
      likelySelfEcho,
      triggeredBargeIn: Boolean(chunk.triggeredBargeIn),
      priorityClass,
    }
  }

  private async runConversationAttempt(
    attempt: AdmittedConversationTurn,
    reportPhase: (phase: ConversationExecutionPhase) => void,
  ): Promise<ConversationCompletionResult> {
    if (this.conversationSessionResetPending || attempt.createdAt <= this.conversationBoundaryAt) {
      this.dependencies.recordRuntimeEvent(
        'Stale Conversation Turn Discarded',
        `turnId=${attempt.turnId}`,
      )
      return { status: 'cancelled', turnId: attempt.turnId }
    }
    if (attempt.screenContextId && attempt.source !== 'text_chat') {
      return {
        status: 'failed',
        turnId: attempt.turnId,
        phase: 'generation',
        error: 'Screen context is only allowed for text chat',
      }
    }
    if (attempt.source === 'continuous_listening' || attempt.source === 'backlog_selected') {
      if (!this.continuousSettings.enabled || this.handledUtteranceIds.has(attempt.turnId)) {
        return { status: 'cancelled', turnId: attempt.turnId }
      }
      this.rememberHandledUtterance(attempt.turnId)
    }
    this.dependencies.recordRuntimeEvent('Conversation Admitted', attempt.turnId)
    for (const [impulse, enabled] of [
      ['direct-address', attempt.semanticCues?.directAddress],
      ['question', attempt.semanticCues?.question],
      ['recognition-uncertain', attempt.semanticCues?.recognitionUncertain],
    ] as const) {
      if (!enabled) continue
      const triggered = this.dependencies.presentation.triggerEarImpulse(impulse, attempt.turnId)
      if (triggered) {
        const current = this.dependencies.getCharacterState()
        this.dependencies.presentation.publishAvatarState({
          mode:
            current.mode === 'acting' ||
            current.mode === 'interrupted' ||
            current.mode === 'sleeping'
              ? 'idle'
              : current.mode,
          emotionKey: current.emotion,
          earImpulse: impulse,
          earImpulseId: `${attempt.turnId}:${impulse}`,
        })
      }
    }
    if (attempt.semanticCues?.directAddress)
      this.dependencies.presentation.triggerReactionGesture('direct-address')
    else if (attempt.semanticCues?.question)
      this.dependencies.presentation.triggerReactionGesture('question')
    if (attempt.triggeredBargeIn) {
      this.dependencies.recordRuntimeEvent(
        'Barge In Conversation Admitted',
        `turn=${attempt.turnId}`,
      )
      this.dependencies.publishRuntimeEvent(
        'BargeInConversationAdmitted',
        'speech',
        `turn=${attempt.turnId}`,
      )
    }
    if (attempt.source !== 'debug' && attempt.source !== 'autonomous_initiative') {
      this.dependencies.pushMessage('user', attempt.text)
    }
    try {
      const result = await this.dependencies.conversationRuntime.execute(attempt, reportPhase)
      if (attempt.source === 'continuous_listening' || attempt.source === 'backlog_selected')
        this.lastContinuousReplyAt = Date.now()
      return result
    } finally {
      this.bargeInPolicy.settleResponse(attempt.turnId)
      this.dependencies.recordRuntimeEvent('Conversation Settled', attempt.turnId)
    }
  }

  private rememberHandledUtterance(id: string): void {
    this.handledUtteranceIds.add(id)
    if (this.handledUtteranceIds.size <= 64) return
    const oldest = this.handledUtteranceIds.values().next().value
    if (oldest) this.handledUtteranceIds.delete(oldest)
  }

  private nextConversationTimestamp(): number {
    return Math.max(Date.now(), this.conversationBoundaryAt + 1)
  }
}
