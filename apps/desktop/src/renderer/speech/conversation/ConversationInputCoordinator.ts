import type { CharacterState } from '../../../shared/runtime/characterState'
import type { RuntimeEventCategory, RuntimeEventType } from '../../../shared/runtime/events'
import type { SerializedSpeechError } from '../../../shared/speech/speechErrors'
import type { MicrophoneDeviceService } from '../../audio/MicrophoneDeviceService'
import type { MicrophoneGateController } from '../../audio/MicrophoneGateController'
import { isDefaultMicrophone, type StreamingModeId } from '../../audio/microphoneGateTypes'
import type { ChatMsg, ControllerState } from '../../controller/contracts'
import type { AvatarRuntime } from '../../runtime/AvatarRuntime'
import type { ConversationRuntime } from '../../runtime/ConversationRuntime'
import type { SyncedAvatarState } from '../../runtime/OverlayRuntime'
import type {
  ContinuousPartialSpeech,
  ContinuousRecognizedSpeech,
  SpeechInputRuntime,
} from '../../runtime/SpeechInputRuntime'
import { semanticEarTuning } from '../../three/avatarTuning'
import { AttentionEngine } from '../continuous-listening/AttentionEngine'
import { BacklogSelector } from '../continuous-listening/BacklogSelector'
import { BargeInPolicy } from '../continuous-listening/BargeInPolicy'
import { ConversationAdmissionCoordinator } from '../continuous-listening/ConversationAdmissionCoordinator'
import { RuleGate } from '../continuous-listening/RuleGate'
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

export interface ConversationInputCoordinatorDependencies {
  speechInputRuntime: SpeechInputRuntime
  conversationRuntime: ConversationRuntime
  microphoneGate: MicrophoneGateController
  avatarRuntime: AvatarRuntime

  getControllerState(): ControllerState
  getCharacterState(): CharacterState

  patchControllerState(patch: Partial<ControllerState>): void
  pushMessage(role: ChatMsg['role'], text: string): void

  recordRuntimeEvent(label: string, detail?: string): void
  publishRuntimeEvent(type: RuntimeEventType, category: RuntimeEventCategory, detail?: string): void

  publishAvatarState(state: SyncedAvatarState): void
  getConfig(): ReturnType<Window['api']['config']['get']>
  saveConfig(
    patch: Parameters<Window['api']['config']['save']>[0],
  ): ReturnType<Window['api']['config']['save']>
  arbitrateBacklog(
    request: Parameters<Window['api']['llm']['arbitrateBacklog']>[0],
  ): ReturnType<Window['api']['llm']['arbitrateBacklog']>
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

  async admitText(text: string, screenContextId?: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    await this.conversationAdmission.admit({
      turnId: this.dependencies.createTurnId('text'),
      text: trimmed,
      source: 'text_chat',
      screenContextId,
      createdAt: Date.now(),
      semanticCues: {
        directAddress: false,
        question: QUESTION_PATTERN.test(trimmed),
        recognitionUncertain: false,
      },
    })
  }

  async admitPushToTalk(text: string): Promise<void> {
    await this.conversationAdmission.admit({
      turnId: this.dependencies.createTurnId('manual-speech'),
      text,
      source: 'push_to_talk',
      createdAt: Date.now(),
      semanticCues: {
        directAddress: false,
        question: QUESTION_PATTERN.test(text),
        recognitionUncertain: false,
      },
    })
  }

  async admitDebug(emotionKey: string): Promise<'admitted' | 'ignored_busy'> {
    return this.conversationAdmission.admit({
      turnId: this.dependencies.createTurnId('debug'),
      text: emotionKey,
      source: 'debug',
      createdAt: Date.now(),
    })
  }

  async applyContinuousSettings(
    settings: ContinuousListeningSettings,
    persist = true,
  ): Promise<void> {
    if (persist) this.desiredContinuousListening = settings.enabled
    this.continuousSettings = { ...settings }
    if (!settings.enabled) {
      this.bargeInPolicy.reset()
      this.bargeInSegments.clear()
      this.streamingSessionId = null
    }
    this.conversationAdmission.setContinuousEnabled(settings.enabled)
    const config = await this.dependencies.getConfig()
    this.conversationAdmission.configureSelector(config.llm.roles.backlogSelector)
    this.dependencies.patchControllerState({
      continuousListeningMode: settings.mode,
      continuousListeningState: settings.enabled ? 'starting' : 'off',
      continuousListeningError: '',
    })
    try {
      await this.dependencies.speechInputRuntime.setContinuousListening(
        settings.enabled,
        (recognized) => this.handleContinuousFinal(recognized),
        (partial) => this.handleContinuousPartial(partial),
        () => {
          void this.handleContinuousDeviceLost()
        },
      )
      this.dependencies.patchControllerState({
        continuousListeningEnabled: settings.enabled,
        continuousListeningState: settings.enabled ? 'on' : 'off',
      })
    } catch (error) {
      this.continuousSettings.enabled = false
      this.conversationAdmission.setContinuousEnabled(false)
      this.dependencies.patchControllerState({
        continuousListeningEnabled: false,
        continuousListeningState: 'error',
        continuousListeningError: this.dependencies.getMicrophoneAccessFailedMessage(),
      })
      throw error
    }
    if (persist) {
      await this.dependencies.saveConfig({
        continuousListeningMode: settings.mode,
        continuousListeningReplyCooldownMs: String(settings.replyCooldownMs),
        continuousListeningFollowUpWindowMs: String(settings.followUpWindowMs),
        continuousListeningCuriosityChance: String(settings.curiosityChance),
      })
    }
  }

  async toggleContinuousListening(): Promise<void> {
    const state = this.dependencies.getControllerState()
    if (state.continuousListeningState === 'starting') return
    if (state.microphoneGate.status !== 'closed') return
    if (this.continuousSettings.enabled) {
      await this.applyContinuousSettings({ ...this.continuousSettings, enabled: false })
      return
    }
    await this.requestStreamingStart(this.continuousSettings.mode)
  }

  handleStreamingServiceLost(_error: SerializedSpeechError): void {
    this.continuousSettings.enabled = false
    this.conversationAdmission.setContinuousEnabled(false)
    this.chunkBuilder = new UtteranceChunkBuilder()
    this.bargeInPolicy.reset()
    this.bargeInSegments.clear()
    this.streamingSessionId = null
    this.dependencies.patchControllerState({
      continuousListeningEnabled: false,
      continuousListeningState: 'off',
      continuousListeningError: '',
    })
    this.dependencies.recordRuntimeEvent(
      'Streaming Service Lost Teardown',
      `desired=${this.desiredContinuousListening}`,
    )
  }

  isContinuousEnabled(): boolean {
    return this.continuousSettings.enabled
  }

  getSettings(): Readonly<ContinuousListeningSettings> {
    return this.continuousSettings
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
    await this.startStreaming(result.intent.modeId)
  }

  private async startStreaming(modeId: StreamingModeId): Promise<void> {
    try {
      await this.applyContinuousSettings({
        ...this.continuousSettings,
        enabled: true,
        mode: modeId,
      })
    } catch (error) {
      const failure = this.dependencies.normalizeMicrophoneFailure(error)
      this.dependencies.recordRuntimeEvent('Streaming Runtime Start Failed', failure.reason)
      this.dependencies.patchControllerState({
        continuousListeningState: 'off',
        continuousListeningError: '',
      })
      const result = await this.dependencies.microphoneGate.request(
        { type: 'start-streaming', modeId },
        'runtime-start-failed',
        failure.reason,
      )
      if (result.status === 'confirmed') {
        this.dependencies.speechInputRuntime.setMicrophone(
          isDefaultMicrophone(result.deviceId) ? '' : result.deviceId,
        )
        await this.startStreaming(result.intent.modeId)
      }
    }
  }

  private async handleContinuousDeviceLost(): Promise<void> {
    if (!this.continuousSettings.enabled) return
    const modeId = this.continuousSettings.mode
    this.dependencies.recordRuntimeEvent('Streaming Microphone Lost', modeId)
    await this.applyContinuousSettings({ ...this.continuousSettings, enabled: false })
    this.dependencies.patchControllerState({
      continuousListeningState: 'off',
      continuousListeningError: '',
    })
    const result = await this.dependencies.microphoneGate.request(
      { type: 'start-streaming', modeId },
      'active-device-lost',
    )
    if (result.status === 'confirmed') {
      this.dependencies.speechInputRuntime.setMicrophone(
        isDefaultMicrophone(result.deviceId) ? '' : result.deviceId,
      )
      await this.startStreaming(result.intent.modeId)
    }
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
    void this.dependencies.conversationRuntime
      .interruptCurrentResponse('voice-barge-in')
      .then((interrupted) => {
        if (!interrupted) this.bargeInSegments.delete(segmentKey)
      })
  }

  private ensureStreamingSession(streamingSessionId: string): void {
    if (this.streamingSessionId === streamingSessionId) return
    if (this.streamingSessionId) this.conversationAdmission.resetStreamingSession()
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
    const attention = this.attentionEngine.evaluate(chunk, {
      mode: this.continuousSettings.mode,
      isSpeaking,
      cooldownActive,
      recentConversation: followUpWindow,
      followUpWindow,
      curiosityChance: this.continuousSettings.curiosityChance,
    })
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
            : attention.mode === 'active' || attention.mode === 'streamer'
              ? 'P3'
              : 'P4'
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
      attentionMode: attention.mode,
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
      const triggered = this.dependencies.avatarRuntime.triggerEarImpulse(impulse, attempt.turnId)
      if (triggered) {
        const current = this.dependencies.getCharacterState()
        this.dependencies.publishAvatarState({
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
      this.dependencies.avatarRuntime.triggerReactionGesture('direct-address')
    else if (attempt.semanticCues?.question)
      this.dependencies.avatarRuntime.triggerReactionGesture('question')
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
    if (attempt.source !== 'debug') this.dependencies.pushMessage('user', attempt.text)
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
}
