import type { CharacterRuntimeMode, CharacterState } from '../shared/runtime/characterState'
import type { RuntimeEvent, RuntimeEventCategory, RuntimeEventType } from '../shared/runtime/events'
import type { SerializedSpeechError } from '../shared/speech/speechErrors'
import { AudioPlayer } from './audio/audioPlayer'
import { MicrophoneDeviceService } from './audio/MicrophoneDeviceService'
import { MicrophoneGateController } from './audio/MicrophoneGateController'
import {
  CLOSED_GATE,
  isDefaultMicrophone,
  type MicrophoneGateDebugState,
  type MicrophoneGateState,
  type MicrophoneIntent,
  type StreamingModeId,
} from './audio/microphoneGateTypes'
import type { AnimationPlaybackStatus } from './avatar/AvatarAnimationController'
import type { AnimationCooldownState } from './avatar/AvatarAnimationCooldownManager'
import type { AvatarAnimationQueueDebugState } from './avatar/AvatarAnimationQueue'
import type { AvatarBehaviorEngineDecision } from './avatar/AvatarBehaviorEngine'
import type { AvatarBehaviorCandidate } from './avatar/AvatarBehaviorResolver'
import type { AvatarBehaviorTransitionLogEntry } from './avatar/AvatarController'
import type { IdleOrchestratorDebugState } from './avatar/AvatarIdleOrchestrator'
import type { AvatarPlaybackRequestDebugState } from './avatar/AvatarPlaybackRequestLog'
import type { SpeakingGestureSchedulerDebugState } from './avatar/AvatarSpeakingGestureScheduler'
import type { DebugAvatarMode } from './avatar/avatarAnimations'
import { AttentionEngine } from './continuousListening/AttentionEngine'
import { BacklogSelector } from './continuousListening/BacklogSelector'
import { BargeInPolicy } from './continuousListening/BargeInPolicy'
import { ConversationAdmissionCoordinator } from './continuousListening/ConversationAdmissionCoordinator'
import { RuleGate } from './continuousListening/RuleGate'
import {
  CORRECTION_PATTERN,
  isExplicitBargeInPhrase,
  textSimilarity,
} from './continuousListening/textAnalysis'
import {
  backlogTuning,
  bargeInTuning,
  defaultContinuousListeningSettings,
  parseAttentionMode,
  parseTunedNumber,
} from './continuousListening/tuning'
import type {
  AdmittedConversationTurn,
  BufferedUtterance,
  ContinuousListeningSettings,
  ConversationCompletionResult,
  ConversationExecutionPhase,
  ConversationInput,
  UtteranceChunk,
} from './continuousListening/types'
import { UtteranceBacklog } from './continuousListening/UtteranceBacklog'
import { UtteranceChunkBuilder } from './continuousListening/UtteranceChunkBuilder'
import { type AvatarMode, AvatarRuntime } from './runtime/AvatarRuntime'
import { ConversationPresenceRuntime } from './runtime/ConversationPresenceRuntime'
import { ConversationRuntime } from './runtime/ConversationRuntime'
import {
  OverlayRuntime,
  type OverlaySettingsView,
  type SyncedAvatarState,
} from './runtime/OverlayRuntime'
import {
  type RuntimeHealth,
  RuntimeStateInvariantValidator,
} from './runtime/RuntimeStateInvariantValidator'
import { ShioRuntime } from './runtime/ShioRuntime'
import { SpeechCapabilitiesRuntime } from './runtime/SpeechCapabilitiesRuntime'
import type {
  ContinuousPartialSpeech,
  ContinuousRecognizedSpeech,
} from './runtime/SpeechInputRuntime'
import { SpeechInputRuntime } from './runtime/SpeechInputRuntime'
import { SpeechRuntime, type SpeechStateTimelineEntry } from './runtime/SpeechRuntime'
import {
  INITIAL_SPEECH_CAPABILITIES,
  type SpeechCapabilitiesState,
} from './runtime/speechCapabilities'
import { TransitionRecorder } from './runtime/TransitionRecorder'
import type { FacialDebugState } from './three/AvatarExpressionMixer'
import { type OverlayViewMode, semanticEarTuning } from './three/avatarTuning'
import type { EarAxisOverride, EarBehaviorDebugState } from './three/EarBehaviorRuntime'
import type { HeadMotionDebugState } from './three/HeadMotionRuntime'
import type { MouthWeights } from './three/LipSync'
import type { LookAtDebugState } from './three/LookAtRuntime'
import { SceneManager } from './three/SceneManager'
import type { VrmBodyActionDebugState } from './three/VrmModel'

export type AppStatus =
  | 'idle'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'synthesizing'
  | 'speaking'

export const STATUS_LABELS: Record<AppStatus, string> = {
  idle: 'Ожидание',
  listening: 'Слушаю...',
  recognizing: 'Распознаю...',
  thinking: 'Думаю...',
  synthesizing: 'Генерирую голос...',
  speaking: 'Говорю...',
}

export interface ChatMsg {
  id: string
  role: 'user' | 'assistant' | 'error' | 'meta'
  text: string
  interrupted?: boolean
}

export type HealthState = 'checking' | 'ok' | 'warn' | 'err'

export interface ControllerState {
  status: AppStatus
  responseInterruptionPending: boolean
  messages: ChatMsg[]
  health: { state: HealthState; text: string }
  /** Read-only projection of Speech API capability availability (ASR/TTS/streaming). */
  speechCapabilities: SpeechCapabilitiesState
  llmHealth: { state: 'unknown' | 'checking' | 'ok' | 'error'; detail: string }
  vrmLoaded: boolean
  faceTrackingEnabled: boolean
  passiveCompanionEnabled: boolean
  continuousListeningEnabled: boolean
  continuousListeningMode: ContinuousListeningSettings['mode']
  continuousListeningState: 'off' | 'starting' | 'on' | 'error'
  continuousListeningError: string
  overlayState: 'off' | 'opening' | 'on' | 'closing' | 'error'
  overlayCameraMode: OverlayViewMode
  overlayError: string
  speechProgress: number
  overlayAnimationHudEnabled: boolean
  overlayAnimationFile: string
  microphoneGate: MicrophoneGateState
}

export interface RuntimeTimelineEvent {
  id: string
  at: number
  label: string
  detail?: string
}

export interface RuntimeDebugSnapshot {
  appStatus: AppStatus
  characterState: CharacterState
  eventHistory: readonly RuntimeEvent[]
  avatarMode: AvatarMode
  emotionKey: string
  vrmEmotion: string
  currentBodyAnimation: string
  currentBodyAnimationFile: string
  currentBodyAnimationLoop: boolean
  currentBodyAnimationStatus: AnimationPlaybackStatus
  bodyActions: VrmBodyActionDebugState
  animationAssetCache: ReturnType<AvatarRuntime['getDebugState']>['animationAssetCache']
  previousBodyAnimation: string
  activeTransitionPolicy: string
  activeBlendDuration: number
  animationQueue: AvatarAnimationQueueDebugState
  speakingGestureScheduler: SpeakingGestureSchedulerDebugState
  behaviorEngine: AvatarBehaviorEngineDecision | null
  currentBehaviorId: string
  currentBehaviorCandidates: AvatarBehaviorCandidate[]
  behaviorSelectionReason: string
  activeAnimationCooldowns: AnimationCooldownState[]
  selectedBehaviorAnimation: string
  currentGesture: string
  idleOrchestrator: IdleOrchestratorDebugState
  lipsyncWeights: MouthWeights
  facial: FacialDebugState
  lookAt: LookAtDebugState
  headMotion: HeadMotionDebugState
  earBehavior: EarBehaviorDebugState
  performance: ReturnType<AvatarRuntime['getDebugState']>['performance']
  playbackRequests: AvatarPlaybackRequestDebugState
  speechTimeline: SpeechStateTimelineEntry[]
  behaviorTimeline: AvatarBehaviorTransitionLogEntry[]
  ttsLatencyMs: string
  ttsCache: string
  overlayState: string
  controllers: Record<string, string>
  timeline: RuntimeTimelineEvent[]
  runtimeHealth: RuntimeHealth | null
}

type SpeechReply = Awaited<ReturnType<Window['api']['tts']['synthesizeReply']>>

type Listener = (state: ControllerState) => void

let idSeq = 0
const nextId = (): string => `m${++idSeq}`
const QUESTION_PATTERN =
  /\?|(?:^|\s)(?:кто|что|где|когда|зачем|почему|как|можешь|скажешь|думаешь)(?:$|[\s,.!?])/iu
export class Controller {
  private shioRuntime = new ShioRuntime()
  private scene: SceneManager | null = null
  // Monotonic token for the local Avatar Preview scene. Bumped on every attach and
  // detach so async VRM loads can detect that the scene they started with was torn
  // down or replaced, and silently abort instead of touching a disposed SceneManager.
  private previewSceneVersion = 0
  private overlayRuntime = new OverlayRuntime()
  private avatarRuntime = new AvatarRuntime(this.shioRuntime.events, {
    overlayMode: this.overlayRuntime.isOverlayWindow(),
  })
  private player = new AudioPlayer()
  private speechRuntime = new SpeechRuntime(
    this.shioRuntime.characterState,
    this.shioRuntime.events,
  )
  private conversationPresenceRuntime = new ConversationPresenceRuntime()
  private speechCapabilitiesRuntime = new SpeechCapabilitiesRuntime({
    events: this.shioRuntime.events,
    onChange: (capabilities) => this.handleSpeechCapabilitiesChange(capabilities),
    recordRuntimeEvent: (label, detail) => this.recordRuntimeEvent(label, detail),
  })
  private conversationRuntime = new ConversationRuntime({
    speechRuntime: this.speechRuntime,
    conversationPresenceRuntime: this.conversationPresenceRuntime,
    avatarRuntime: this.avatarRuntime,
    overlayRuntime: this.overlayRuntime,
    events: this.shioRuntime.events,
    player: this.player,
    setStatus: (status) => this.set({ status }),
    pushMessage: (role, text) => this.pushMessage(role, text),
    markAssistantMessageInterrupted: () => this.markAssistantMessageInterrupted(),
    setResponseInterruptionPending: (pending) => this.set({ responseInterruptionPending: pending }),
    recordRuntimeEvent: (label, detail) => this.recordRuntimeEvent(label, detail),
    reportSpeechServiceError: (error) => this.reportSpeechServiceError(error),
    updateCharacterState: (patch) => this.updateCharacterState(patch),
    rememberSpeechMetadata: (speech) => this.rememberSpeechMetadata(speech),
    updateSpeechPlaybackProgress: (progress) => this.updateSpeechPlaybackProgress(progress),
    isContinuousCaptureAlive: () => this.speechInputRuntime.isContinuousCaptureAlive(),
  })
  private speechInputRuntime = new SpeechInputRuntime({
    speechRuntime: this.speechRuntime,
    avatarRuntime: this.avatarRuntime,
    overlayRuntime: this.overlayRuntime,
    events: this.shioRuntime.events,
    setStatus: (status) => this.set({ status }),
    pushMessage: (role, text) => this.pushMessage(role, text),
    recordRuntimeEvent: (label, detail) => this.recordRuntimeEvent(label, detail),
    reportSpeechServiceError: (error) => this.reportSpeechServiceError(error),
    updateCharacterState: (patch) => this.updateCharacterState(patch),
  })
  private microphoneDeviceService = new MicrophoneDeviceService()
  private microphoneGate = new MicrophoneGateController({
    service: this.microphoneDeviceService,
    getSavedDeviceId: () => this.speechInputRuntime.getMicrophoneId(),
    onStateChange: (microphoneGate) => this.set({ microphoneGate }),
    recordEvent: (label, detail) => this.recordRuntimeEvent(label, detail),
  })
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
  private backlogSelector = new BacklogSelector(async (items, backlogVersion, config) => {
    const response = await window.api.llm.arbitrateBacklog({
      items,
      backlogVersion,
      providerId: config.providerId,
      model: config.model,
    })
    if (!response.ok || !response.result)
      throw new Error(response.error ?? 'Backlog arbitration failed')
    return response.result
  })
  private conversationAdmission = new ConversationAdmissionCoordinator(
    (attempt, reportPhase) => this.runConversationAttempt(attempt, reportPhase),
    this.utteranceBacklog,
    this.backlogSelector,
    (error, attempt) =>
      this.recordRuntimeEvent('Conversation Admission Error', `${attempt.turnId}:${String(error)}`),
  )

  private state: ControllerState = {
    status: 'idle',
    responseInterruptionPending: false,
    messages: [],
    health: { state: 'checking', text: 'Проверка...' },
    speechCapabilities: INITIAL_SPEECH_CAPABILITIES,
    llmHealth: { state: 'unknown', detail: 'Проверяется при первом запросе' },
    vrmLoaded: false,
    faceTrackingEnabled: false,
    passiveCompanionEnabled: false,
    continuousListeningEnabled: false,
    continuousListeningMode: 'silent',
    continuousListeningState: 'off',
    continuousListeningError: '',
    overlayState: 'off',
    overlayCameraMode: 'front',
    overlayError: '',
    speechProgress: 0,
    overlayAnimationHudEnabled: false,
    overlayAnimationFile: '',
    microphoneGate: CLOSED_GATE,
  }
  private overlayCommand: Promise<void> = Promise.resolve()
  private overlayDesired: boolean | null = null
  private listeners = new Set<Listener>()
  private timeline: RuntimeTimelineEvent[] = []
  private unsubscribeActionEvents: (() => void) | null = null
  private actionRuntimeBoundary = { process: 'main', source: 'main.actionRuntime' }
  private lastVrmEmotion = 'none'
  private lastTtsLatencyMs = 'none'
  private lastTtsCache = 'none'
  // Dedup for the one-per-incident "показан текстом" note while TTS is down.
  private lastSynthesisNoticeIncidentId = 0
  // The user's intended streaming preference, independent of the effective state.
  // A Speech API loss disables streaming without clearing this intent.
  private desiredContinuousListening = false
  private invariantValidator = new RuntimeStateInvariantValidator()
  private transitionRecorder = new TransitionRecorder()
  private frameCounter = 0
  private lastValidationAt = 0
  private bootstrapped = false
  private avatarTickRafId: number | null = null
  private avatarTickLastTime = 0

  constructor() {
    this.shioRuntime.registry.register('speech', this.speechRuntime)
    this.shioRuntime.registry.register('speechInput', this.speechInputRuntime)
    this.shioRuntime.registry.register('speechCapabilities', this.speechCapabilitiesRuntime)
    this.shioRuntime.registry.register('conversation', this.conversationRuntime)
    this.shioRuntime.registry.register('conversationPresence', this.conversationPresenceRuntime)
    this.shioRuntime.registry.register('avatar', this.avatarRuntime)
    this.shioRuntime.registry.register('overlay', this.overlayRuntime)
    this.shioRuntime.registry.register('action', this.actionRuntimeBoundary)
    this.speechInputRuntime.setStreamingServiceLostHandler((error) =>
      this.handleStreamingServiceLost(error),
    )
  }

  // ---- Speech API capabilities (read-only health component) ----------------
  /**
   * Single funnel from runtime paths (ASR/TTS/streaming) into the capabilities
   * health component. For a Speech-output failure it also appends the "показан
   * текстом" note once per incident, so history is not spammed while TTS is down.
   */
  private reportSpeechServiceError(error: SerializedSpeechError): void {
    this.speechCapabilitiesRuntime.reportError(error)
    if (error.operation === 'synthesis') {
      const incidentId = this.speechCapabilitiesRuntime.getState().incidentId
      if (incidentId !== this.lastSynthesisNoticeIncidentId) {
        this.lastSynthesisNoticeIncidentId = incidentId
        this.pushMessage('meta', 'Озвучивание недоступно. Ответ показан текстом.')
      }
    }
  }

  private handleSpeechCapabilitiesChange(capabilities: SpeechCapabilitiesState): void {
    this.set({ speechCapabilities: capabilities, health: this.toLegacyHealth(capabilities) })
  }

  private toLegacyHealth(capabilities: SpeechCapabilitiesState): {
    state: HealthState
    text: string
  } {
    switch (capabilities.service) {
      case 'available':
        return { state: 'ok', text: 'ASR / TTS OK' }
      case 'degraded':
        return { state: 'warn', text: 'Speech API частично доступен' }
      case 'unavailable':
        return { state: 'err', text: 'Speech API недоступен' }
      default:
        return { state: 'checking', text: 'Проверка...' }
    }
  }

  /** Manual recheck ("Повторить подключение" / "Проверить снова"). */
  recheckSpeechService(): void {
    this.speechCapabilitiesRuntime.recheck()
  }

  /**
   * The streaming Speech API was lost mid-session. Speech Input Runtime already
   * released capture/transport and reported the streaming capability failure.
   * Here we drop any buffered partial and settle the streaming UI state WITHOUT
   * overwriting the user's saved streaming preference (desiredContinuousListening
   * stays true), so nothing auto-restarts and no config write flips `enabled`.
   */
  private handleStreamingServiceLost(_error: SerializedSpeechError): void {
    this.continuousSettings.enabled = false
    this.conversationAdmission.setContinuousEnabled(false)
    this.chunkBuilder = new UtteranceChunkBuilder()
    this.bargeInPolicy.reset()
    this.bargeInSegments.clear()
    this.streamingSessionId = null
    this.set({
      continuousListeningEnabled: false,
      continuousListeningState: 'off',
      continuousListeningError: '',
    })
    this.recordRuntimeEvent(
      'Streaming Service Lost Teardown',
      `desired=${this.desiredContinuousListening}`,
    )
  }

  // ---- observable plumbing -------------------------------------------------
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb)
    cb(this.state)
    return () => this.listeners.delete(cb)
  }

  getState(): ControllerState {
    return this.state
  }

  private set(patch: Partial<ControllerState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.state)
  }

  private pushMessage(role: ChatMsg['role'], text: string): void {
    this.set({ messages: [...this.state.messages, { id: nextId(), role, text }] })
  }

  private markAssistantMessageInterrupted(): void {
    const messages = [...this.state.messages]
    const index = messages.findLastIndex((message) => message.role === 'assistant')
    if (index < 0) return
    messages[index] = { ...messages[index], interrupted: true }
    this.set({ messages })
  }

  interruptCurrentResponse(source: 'manual-stop' | 'voice-barge-in'): Promise<boolean> {
    return this.conversationRuntime.interruptCurrentResponse(source)
  }

  private recordRuntimeEvent(label: string, detail?: string): void {
    this.timeline = [
      ...this.timeline,
      {
        id: nextId(),
        at: Date.now(),
        label,
        detail,
      },
    ].slice(-80)
  }

  private publishControllerRuntimeEvent(
    type: RuntimeEventType,
    category: RuntimeEventCategory,
    detail?: string,
  ): void {
    this.shioRuntime.events.publish({
      type,
      category,
      source: 'renderer.controller',
      detail,
    })
  }

  async getRuntimeDebug(): Promise<RuntimeDebugSnapshot> {
    const overlayState = await this.overlayRuntime.getDebugState()

    const avatar = this.avatarRuntime.getDebugState()
    const micGate = this.getMicrophoneGateDebug()
    return {
      appStatus: this.state.status,
      characterState: this.getCharacterStateSnapshot(),
      eventHistory: this.shioRuntime.events.getHistory(),
      avatarMode: avatar.mode,
      emotionKey: avatar.emotionKey,
      vrmEmotion: this.lastVrmEmotion,
      currentBodyAnimation: avatar.currentBodyAnimation,
      currentBodyAnimationFile: avatar.currentBodyAnimationFile,
      currentBodyAnimationLoop: avatar.currentBodyAnimationLoop,
      currentBodyAnimationStatus: avatar.currentBodyAnimationStatus,
      bodyActions: avatar.bodyActions,
      animationAssetCache: avatar.animationAssetCache,
      previousBodyAnimation: avatar.previousBodyAnimation,
      activeTransitionPolicy: avatar.activeTransitionPolicy,
      activeBlendDuration: avatar.activeBlendDuration,
      animationQueue: avatar.animationQueue,
      speakingGestureScheduler: avatar.speakingGestureScheduler,
      behaviorEngine: avatar.behaviorEngine,
      currentBehaviorId: avatar.currentBehaviorId,
      currentBehaviorCandidates: avatar.currentBehaviorCandidates,
      behaviorSelectionReason: avatar.behaviorSelectionReason,
      activeAnimationCooldowns: avatar.activeAnimationCooldowns,
      selectedBehaviorAnimation: avatar.selectedBehaviorAnimation,
      currentGesture: avatar.currentGesture,
      idleOrchestrator: avatar.idleOrchestrator,
      lipsyncWeights: avatar.lipsyncWeights,
      facial: avatar.facial,
      lookAt: avatar.lookAt,
      headMotion: avatar.headMotion,
      earBehavior: avatar.earBehavior,
      performance: avatar.performance,
      playbackRequests: avatar.playbackRequests,
      speechTimeline: this.speechRuntime.getSpeechTimeline(),
      behaviorTimeline: avatar.behaviorTimeline,
      ttsLatencyMs: this.lastTtsLatencyMs,
      ttsCache: this.lastTtsCache,
      overlayState,
      controllers: {
        avatar: this.avatarRuntime.isLoaded() ? 'loaded' : 'not loaded',
        behavior: avatar.currentBehaviorId,
        behaviorIntent: avatar.behaviorEngine?.intent ?? 'none',
        selectedAnimation: avatar.selectedBehaviorAnimation,
        transitionPolicy: avatar.activeTransitionPolicy,
        blendDuration: `${avatar.activeBlendDuration}s`,
        transitionPending: avatar.playbackRequests.transitionPending ? 'yes' : 'no',
        ignoredDuplicateRequests: String(avatar.playbackRequests.ignoredDuplicateRequests),
        replayCount: String(avatar.playbackRequests.replayCount),
        bodyActions: String(avatar.bodyActions.activeActionCount),
        weightedBodyActions: String(avatar.bodyActions.weightedActionCount),
        rootMotionPolicy: avatar.bodyActions.rootMotionPolicy,
        lookAtMode: avatar.lookAt.mode,
        lookAtTarget: avatar.lookAt.target,
        headMotionProfile: avatar.headMotion.profile,
        headMotionEnergy: avatar.headMotion.motionEnergy.toFixed(3),
        lastLoadSource: avatar.bodyActions.lastLoadSource,
        lastLoadAnimation: avatar.bodyActions.lastLoadAnimationId ?? 'none',
        restartCount: String(avatar.bodyActions.restartCount),
        queueLength: String(avatar.animationQueue.length),
        speakingGestureSession: avatar.speakingGestureScheduler.active
          ? `#${avatar.speakingGestureScheduler.sessionId}`
          : 'inactive',
        speakingGesturePhase: avatar.speakingGestureScheduler.phase,
        animationFile: avatar.currentBodyAnimationFile,
        idleOrchestrator: avatar.idleOrchestrator.paused ? 'paused' : 'running',
        idleBehavior: avatar.idleBehavior,
        nextIdleBehaviorIn: `${avatar.nextIdleBehaviorIn}s`,
        passiveCompanion: avatar.passiveCompanionMode ? 'on' : 'off',
        animationFailures: avatar.animationFailures.length
          ? avatar.animationFailures.join(', ')
          : 'none',
        audio: this.player.isPlaying() ? 'playing' : 'idle',
        microphone: this.state.status === 'listening' ? 'recording' : 'idle',
        faceTracking: this.state.faceTrackingEnabled ? 'on' : 'off',
        micGateStatus: micGate.gateStatus,
        micGatePendingIntent: micGate.pendingIntent
          ? micGate.pendingIntent.type === 'start-streaming'
            ? `start-streaming:${micGate.pendingIntent.modeId}`
            : 'start-voice-input'
          : 'none',
        micGateOpenReason: micGate.openReason ?? 'none',
        micGateSelectedDevice: micGate.selectedDeviceLabel ?? 'none',
        micGateLastValidation:
          micGate.lastValidationSucceeded === null
            ? 'none'
            : micGate.lastValidationSucceeded
              ? 'ok'
              : (micGate.lastFailureReason ?? 'failed'),
        micGateLastErrorName: micGate.lastNativeErrorName ?? 'none',
        micGateLastConstraint: micGate.lastConstraint ?? 'none',
      },
      timeline: this.timeline,
      runtimeHealth: this.invariantValidator.getHealth(),
    }
  }

  // ---- lifecycle -----------------------------------------------------------
  async bootstrap(): Promise<void> {
    if (this.bootstrapped) return
    this.bootstrapped = true
    this.subscribeActionRuntimeEvents()
    this.publishControllerRuntimeEvent('RuntimeInitialized', 'system')
    this.recordRuntimeEvent(this.overlayRuntime.runtimeAttachedLabel())
    await this.checkHealth()
    void this.checkLlmHealth()

    const cfg = await window.api.config.get()
    // The overlay renderer is a presentation projection, not a second
    // application runtime. It must never start microphone capture, admission,
    // generation, synthesis, or playback. It only consumes the main renderer's
    // avatar/mouth projections and maintains its own visual tick.
    if (this.overlayRuntime.isOverlayWindow()) {
      const remote = await this.overlayRuntime.loadInitialRemoteState()
      if (remote.avatarState) this.applyRemoteAvatarState(remote.avatarState, false)
      if (remote.mouthWeights) this.applyRemoteMouthWeights(remote.mouthWeights)
      this.startAvatarTickLoop()
      return
    }
    this.applyOverlayConfigProjection(cfg)
    const overlay = await window.api.overlay.isVisible()
    this.set({ overlayState: overlay.visible ? 'on' : 'off' })
    window.api.config.onUpdated((updated) => this.applyOverlayConfigProjection(updated))
    this.speechInputRuntime.setMicrophone(cfg.micDeviceId ?? '', false)
    // Camera-follow gaze is the normal embodiment default; the persisted key is
    // retained for backward compatibility but no longer controls product UI.
    this.set({ faceTrackingEnabled: true })
    this.setPassiveCompanionMode(cfg.passiveCompanionEnabled === 'true', false)
    // Streaming is never auto-started at launch: that would call getUserMedia()
    // (a permission prompt) without an explicit user action, which the
    // microphone-gate contract forbids. The remembered mode is restored, but the
    // user must explicitly enable streaming, which runs the microphone guard.
    await this.applyContinuousListeningSettings(
      {
        enabled: false,
        mode: parseAttentionMode(cfg.continuousListeningMode),
        replyCooldownMs: parseTunedNumber(
          cfg.continuousListeningReplyCooldownMs,
          defaultContinuousListeningSettings.replyCooldownMs,
          0,
          120_000,
        ),
        followUpWindowMs: parseTunedNumber(
          cfg.continuousListeningFollowUpWindowMs,
          defaultContinuousListeningSettings.followUpWindowMs,
          0,
          120_000,
        ),
        curiosityChance: parseTunedNumber(
          cfg.continuousListeningCuriosityChance,
          defaultContinuousListeningSettings.curiosityChance,
          0,
          1,
        ),
      },
      false,
    )
    this.startAvatarTickLoop()
  }

  async toggleOverlay(): Promise<void> {
    const actual =
      this.state.overlayState === 'error'
        ? Boolean((await window.api.overlay.isVisible()).visible)
        : this.state.overlayState === 'on'
    const desired = this.overlayDesired ?? !actual
    await this.setOverlayVisible(desired)
  }

  async setOverlayVisible(visible: boolean): Promise<void> {
    this.overlayDesired = visible
    this.overlayCommand = this.overlayCommand
      .catch(() => undefined)
      .then(() => this.reconcileOverlayVisibility())
    await this.overlayCommand
  }

  async refreshOverlayVisibility(): Promise<void> {
    if (this.overlayDesired !== null) return
    const overlay = await window.api.overlay.isVisible()
    this.set({ overlayState: overlay.visible ? 'on' : 'off' })
  }

  async setOverlayViewMode(mode: OverlayViewMode): Promise<void> {
    const previous = this.state.overlayCameraMode
    if (mode === previous) return
    try {
      const result = await window.api.config.save({ overlayViewMode: mode })
      if (!result.ok) throw new Error(result.error ?? 'save failed')
      this.applyOverlayConfigProjection({ overlayViewMode: mode })
      await window.api.overlay.applySettings()
    } catch (error) {
      this.set({
        overlayCameraMode: previous,
        overlayError: `Не удалось применить режим ${mode}`,
        overlayState: 'error',
      })
      throw error
    }
  }

  private applyOverlayConfigProjection(cfg: OverlaySettingsView): void {
    const overlayCameraMode =
      cfg.overlayViewMode === 'bust' ||
      cfg.overlayViewMode === 'face' ||
      cfg.overlayViewMode === 'portrait'
        ? cfg.overlayViewMode
        : 'front'
    this.set({ overlayCameraMode })
  }

  private async reconcileOverlayVisibility(): Promise<void> {
    while (this.overlayDesired !== null) {
      const desired = this.overlayDesired
      const actual = await window.api.overlay.isVisible()
      if (Boolean(actual.visible) === desired) {
        this.overlayDesired = null
        this.set({ overlayState: desired ? 'on' : 'off', overlayError: '' })
        return
      }
      this.set({ overlayState: desired ? 'opening' : 'closing', overlayError: '' })
      try {
        await window.api.overlay.toggle()
        const verified = await window.api.overlay.isVisible()
        if (Boolean(verified.visible) === desired && this.overlayDesired === desired) {
          this.overlayDesired = null
          this.set({ overlayState: desired ? 'on' : 'off', overlayError: '' })
          return
        }
      } catch (error) {
        const verified = await window.api.overlay.isVisible().catch(() => ({ visible: false }))
        this.overlayDesired = null
        this.set({
          overlayState: 'error',
          overlayError: desired ? 'Не удалось открыть камеру' : 'Не удалось закрыть камеру',
        })
        if (Boolean(verified.visible) !== desired) throw error
        return
      }
    }
  }

  async attachCanvas(
    canvas: HTMLCanvasElement,
    options: { loadModel?: boolean } = {},
  ): Promise<void> {
    await this.bootstrap()
    if (this.scene) return
    const scene = new SceneManager(canvas)
    const version = ++this.previewSceneVersion
    this.scene = scene
    scene.start()

    const cfg = await window.api.config.get()
    this.applyOverlaySettings(cfg)
    if (options.loadModel !== false && cfg.vrmPath)
      await this.loadVrmFromPath(cfg.vrmPath, scene, version)
  }

  detachCanvas(): void {
    if (!this.scene || this.overlayRuntime.isOverlayWindow()) return
    // Invalidate any in-flight preview load so its post-await steps abort.
    ++this.previewSceneVersion
    this.scene.dispose()
    this.scene = null
    this.set({ vrmLoaded: false })
  }

  // Avatar Runtime tick (LipSync, facial mixer, overlay mouth-weight publish) must
  // stay alive independent of whether the main Preview canvas is mounted, so that
  // closing/opening Preview never breaks the Overlay's LipSync feed.
  private startAvatarTickLoop(): void {
    if (this.avatarTickRafId !== null) return
    this.avatarTickLastTime = performance.now()
    const loop = (): void => {
      this.avatarTickRafId = requestAnimationFrame(loop)
      const now = performance.now()
      const delta = (now - this.avatarTickLastTime) / 1000
      this.avatarTickLastTime = now
      this.frameCounter += 1
      this.avatarRuntime.update(delta, this.speechRuntime.getCharacterState())
      this.updateOverlayAnimationHudFile()
      this.overlayRuntime.publishMouthWeightsFrame(
        delta,
        this.state.status === 'speaking',
        this.avatarRuntime.getMouthWeights(),
      )
      this.runRuntimeInvariantValidation()
      this.transitionRecorder.observe(
        this.frameCounter,
        this.avatarRuntime.getDebugState(),
        this.invariantValidator.getHealth(),
      )
    }
    loop()
  }

  applyOverlaySettings(cfg: OverlaySettingsView): void {
    this.overlayRuntime.applySettings(this.scene, cfg)
    if (this.overlayRuntime.isOverlayWindow()) {
      const mode =
        cfg.overlayViewMode === 'bust' ||
        cfg.overlayViewMode === 'face' ||
        cfg.overlayViewMode === 'portrait'
          ? cfg.overlayViewMode
          : 'front'
      this.avatarRuntime.setCameraMode(mode)
    }
    this.set({ overlayAnimationHudEnabled: cfg.overlayShowCurrentAnimation === 'true' })
    this.updateOverlayAnimationHudFile()
  }

  subscribeOverlayUpdates(): void {
    this.overlayRuntime.subscribeToRemoteUpdates({
      avatarState: (state) => this.applyRemoteAvatarState(state, true),
      mouthWeights: (weights) => this.applyRemoteMouthWeights(weights),
      settings: (cfg) => this.applyOverlaySettings(cfg),
    })
  }

  applyRemoteMouthWeights(weights: MouthWeights): void {
    if (!this.overlayRuntime.isOverlayWindow()) return
    this.avatarRuntime.setMouthWeights(weights)
  }

  applyRemoteAvatarState(avatarState: SyncedAvatarState, allowReaction = false): void {
    if (!this.overlayRuntime.isOverlayWindow()) return
    const status = this.toAppStatus(avatarState.mode)
    this.updateCharacterState({
      status,
      mode: avatarState.mode,
      emotion: avatarState.emotionKey ?? 'neutral',
      vrmEmotion: avatarState.vrmEmotion,
    })
    this.applyAvatarCharacterState()
    if (allowReaction && avatarState.reaction === 'user-interruption')
      this.avatarRuntime.triggerUserInterruption()
    if (allowReaction && avatarState.earImpulse)
      this.avatarRuntime.triggerEarImpulse(avatarState.earImpulse, avatarState.earImpulseId)
    this.updateOverlayAnimationHudFile()
  }

  private publishAvatarState(state: SyncedAvatarState): void {
    this.overlayRuntime.publishAvatarState(state)
  }

  private updateOverlayAnimationHudFile(): void {
    if (!this.overlayRuntime.isOverlayWindow()) return
    const avatar = this.avatarRuntime.getDebugState()
    const activeFileName =
      avatar.currentBodyAnimationFile === 'none' ? '' : avatar.currentBodyAnimationFile
    if (activeFileName !== this.state.overlayAnimationFile)
      this.set({ overlayAnimationFile: activeFileName })
  }

  private updateCharacterState(patch: {
    status: AppStatus
    mode: CharacterRuntimeMode
    emotion: string
    vrmEmotion?: string
    avatar?: ReturnType<AvatarRuntime['getMirrorState']>
    conversationPresence?: CharacterState['conversationPresence']
  }): CharacterState {
    const characterState = this.speechRuntime.transitionSpeechState({
      status: patch.status,
      mode: patch.mode,
      emotion: patch.emotion,
      vrmEmotion: patch.vrmEmotion,
      currentSentence:
        patch.status === 'speaking' ? (this.state.messages.at(-1)?.text ?? '') : undefined,
      conversationPresence: patch.conversationPresence,
    })
    const avatarMirror = this.avatarRuntime.getMirrorState()
    return this.speechRuntime.mirrorAvatarState({
      ...avatarMirror,
      ...patch.avatar,
      loaded: patch.avatar?.loaded ?? avatarMirror.loaded ?? characterState.avatar.loaded,
    })
  }

  private updateSpeechPlaybackProgress(progress: number): void {
    const speechProgress = Math.max(0, Math.min(1, progress))
    this.speechRuntime.updateSpeechPlaybackProgress(speechProgress)
    this.set({ speechProgress })
  }

  private applyAvatarCharacterState(): void {
    this.avatarRuntime.applyCharacterState(this.speechRuntime.getCharacterState())
    this.updateOverlayAnimationHudFile()
  }

  /**
   * Diagnostics-only: feed a read-only cross-subsystem snapshot to the Runtime
   * State Invariant Validator. Throttled to ~10 Hz to keep it cheap; observes
   * only, never mutates any runtime.
   */
  private runRuntimeInvariantValidation(): void {
    if (!this.invariantValidator.isEnabled()) return
    const now = performance.now()
    if (now - this.lastValidationAt < 100) return
    this.lastValidationAt = now

    const character = this.speechRuntime.getCharacterState()
    const avatar = this.avatarRuntime.getDebugState()
    const playback = this.player.getPlaybackDebug()
    const facial = avatar.facial
    this.invariantValidator.evaluate({
      frame: this.frameCounter,
      now,
      speechStatus: character.speechState.status,
      isSpeaking: character.speechState.status === 'speaking',
      characterMode: character.mode,
      avatarMode: avatar.mode,
      conversationResponsePhase: character.conversationPresence.responsePhase,
      playbackActive: playback.playing,
      activePlaybackId: playback.activePlaybackId,
      bodyActiveActionCount: avatar.bodyActions.activeActionCount,
      bodyWeightedActionCount: avatar.bodyActions.weightedActionCount,
      bodyTransitionRemaining: avatar.bodyActions.transitionRemaining,
      bodyOwnershipGapCount: avatar.bodyActions.ownershipGapCount,
      currentBodyAnimation: avatar.currentBodyAnimation,
      currentBehaviorId: avatar.currentBehaviorId,
      mouthMax: Math.max(
        facial.mouth.aa,
        facial.mouth.ih,
        facial.mouth.ou,
        facial.mouth.ee,
        facial.mouth.oh,
      ),
      facialActiveSources: facial.activeSources,
      facialEntrySources: facial.entries.map((entry) => entry.source),
      facialSupportedVisemes: facial.supportedVisemes,
      facialUnsupportedExpressionRequests: facial.unsupportedExpressionRequests,
      currentFacialProfile: facial.currentProfile,
      facialStuckWarnings: facial.stuckWarnings,
      lookAtTarget: avatar.lookAt.target,
      lookAtEyeYaw: avatar.lookAt.eyeYaw,
      lookAtEyePitch: avatar.lookAt.eyePitch,
      headMotionActiveGenerators: avatar.headMotion.activeGenerators,
      headMotionEnergy: avatar.headMotion.motionEnergy,
    })
  }

  private rememberSpeechMetadata(speech: SpeechReply): void {
    this.lastVrmEmotion = speech.vrmEmotion ?? 'none'
    this.lastTtsLatencyMs = speech.latencyMs ?? 'none'
    this.lastTtsCache = speech.cache ?? 'none'
  }

  private toAppStatus(mode: AvatarMode): AppStatus {
    switch (mode) {
      case 'listening':
        return 'listening'
      case 'thinking':
        return 'thinking'
      case 'awaitingSpeech':
        return 'synthesizing'
      case 'speaking':
        return 'speaking'
      default:
        return 'idle'
    }
  }

  private getCharacterStateSnapshot(): CharacterState {
    const avatar = this.avatarRuntime.getDebugState()
    const characterState = this.speechRuntime.getCharacterState()
    const mode = characterState.mode
    const speech = characterState.speechState.status
    return {
      ...characterState,
      speechState: {
        ...characterState.speechState,
        isSpeaking: speech === 'speaking',
      },
      animation: {
        behavior: avatar.currentBehaviorId,
        animationId: avatar.currentBodyAnimation,
        queueLength: avatar.animationQueue.length,
      },
      posture:
        mode === 'thinking' || mode === 'awaitingSpeech'
          ? 'thinking'
          : mode === 'idle'
            ? 'relaxed'
            : characterState.posture,
      conversation: {
        ...characterState.conversation,
        replyType: avatar.behaviorEngine?.replyType ?? characterState.conversation.replyType,
        conversationPhase:
          speech === 'speaking'
            ? 'replying'
            : mode === 'thinking' || mode === 'awaitingSpeech'
              ? 'thinking'
              : characterState.conversation.conversationPhase,
      },
      avatar: {
        ...characterState.avatar,
        mode,
        expression: characterState.emotion,
        lipsync: avatar.lipsyncWeights,
        loaded: this.avatarRuntime.isLoaded(),
      },
      updatedAt: Date.now(),
    }
  }

  // ---- microphone device selection ----------------------------------------
  async listMicrophones(): Promise<Array<{ deviceId: string; label: string }>> {
    // Labels are only populated once mic permission has been granted.
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Микрофон' }))
  }

  setMicrophone(deviceId: string): void {
    this.speechInputRuntime.setMicrophone(deviceId)
  }

  getMicrophoneId(): string {
    return this.speechInputRuntime.getMicrophoneId()
  }

  // ---- chat cycle ----------------------------------------------------------
  async sendText(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    await this.conversationAdmission.admit({
      turnId: `text-${nextId()}`,
      text: trimmed,
      source: 'text_chat',
      createdAt: Date.now(),
      semanticCues: {
        directAddress: false,
        question: QUESTION_PATTERN.test(trimmed),
        recognitionUncertain: false,
      },
    })
  }

  async runDebugFullRuntimeTest(emotionKey = 'happy'): Promise<void> {
    const outcome = await this.conversationAdmission.admit({
      turnId: `debug-${nextId()}`,
      text: emotionKey,
      source: 'debug',
      createdAt: Date.now(),
    })
    if (outcome === 'ignored_busy')
      this.recordRuntimeEvent('Test Full Runtime Blocked', this.state.status)
  }

  // ---- microphone ----------------------------------------------------------
  async toggleMic(): Promise<void> {
    if (this.speechInputRuntime.isContinuousListening()) return
    // Stopping an in-progress recording never needs the microphone guard.
    if (this.state.status === 'listening') {
      const recognized = await this.speechInputRuntime.toggle('listening')
      if (!recognized) return
      await this.conversationAdmission.admit({
        turnId: `manual-speech-${nextId()}`,
        text: recognized.text,
        source: 'push_to_talk',
        createdAt: Date.now(),
        semanticCues: {
          directAddress: false,
          question: QUESTION_PATTERN.test(recognized.text),
          recognitionUncertain: false,
        },
      })
      return
    }
    if (this.state.status !== 'idle') return
    // Starting voice input runs the same blocking microphone guard as streaming;
    // only the intent (and gate copy) differ.
    const result = await this.microphoneGate.request(
      { type: 'start-voice-input' },
      'not-configured',
    )
    if (result.status === 'confirmed')
      await this.executeMicrophoneIntent(result.intent, result.deviceId)
  }

  async applyContinuousListeningSettings(
    settings: ContinuousListeningSettings,
    persist = true,
  ): Promise<void> {
    // A persisted change reflects explicit user intent for streaming.
    if (persist) this.desiredContinuousListening = settings.enabled
    this.continuousSettings = { ...settings }
    if (!settings.enabled) {
      this.bargeInPolicy.reset()
      this.bargeInSegments.clear()
      this.streamingSessionId = null
    }
    this.conversationAdmission.setContinuousEnabled(settings.enabled)
    const config = await window.api.config.get()
    this.conversationAdmission.configureSelector(config.llm.roles.backlogSelector)
    this.set({
      continuousListeningMode: settings.mode,
      continuousListeningState: settings.enabled ? 'starting' : 'off',
      continuousListeningError: '',
    })
    try {
      await this.speechInputRuntime.setContinuousListening(
        settings.enabled,
        (recognized) => this.handleContinuousFinal(recognized),
        (partial) => this.handleContinuousPartial(partial),
        () => {
          void this.handleContinuousDeviceLost()
        },
      )
      this.set({
        continuousListeningEnabled: settings.enabled,
        continuousListeningState: settings.enabled ? 'on' : 'off',
      })
    } catch (error) {
      this.continuousSettings.enabled = false
      this.conversationAdmission.setContinuousEnabled(false)
      this.set({
        continuousListeningEnabled: false,
        continuousListeningState: 'error',
        continuousListeningError: 'Не удалось получить доступ к микрофону.',
      })
      throw error
    }
    if (persist) {
      await window.api.config.save({
        continuousListeningMode: settings.mode,
        continuousListeningReplyCooldownMs: String(settings.replyCooldownMs),
        continuousListeningFollowUpWindowMs: String(settings.followUpWindowMs),
        continuousListeningCuriosityChance: String(settings.curiosityChance),
      })
    }
  }

  async toggleContinuousListening(): Promise<void> {
    if (this.state.continuousListeningState === 'starting') return
    // While the microphone gate is open, streaming controls are intentionally inert.
    if (this.state.microphoneGate.status !== 'closed') return
    if (this.continuousSettings.enabled) {
      // Turning streaming OFF never needs the microphone guard.
      await this.applyContinuousListeningSettings({ ...this.continuousSettings, enabled: false })
      return
    }
    await this.requestStreamingStart(this.continuousSettings.mode)
  }

  // ---- microphone prerequisite guard ---------------------------------------
  /**
   * Single entry point that runs the microphone guard for a streaming start and,
   * only on confirmation, executes the intent. Cancellation leaves streaming OFF.
   */
  private async requestStreamingStart(modeId: StreamingModeId): Promise<void> {
    const intent: MicrophoneIntent = { type: 'start-streaming', modeId }
    const result = await this.microphoneGate.request(intent, 'not-configured')
    if (result.status !== 'confirmed') {
      this.recordRuntimeEvent('Streaming Start Blocked', modeId)
      return
    }
    await this.executeMicrophoneIntent(result.intent, result.deviceId)
  }

  /** Persist the confirmed device, then run the confirmed intent. */
  private async executeMicrophoneIntent(intent: MicrophoneIntent, deviceId: string): Promise<void> {
    this.speechInputRuntime.setMicrophone(isDefaultMicrophone(deviceId) ? '' : deviceId)
    if (intent.type === 'start-streaming') {
      await this.startStreaming(intent.modeId)
      return
    }
    await this.startVoiceInput()
  }

  /**
   * Open the real working stream through Speech Runtime. A successful probe does
   * NOT count as a running stream: `on` is set only after the working stream
   * actually opens. On a microphone-related failure the runtime is torn down,
   * no false `listening` remains, and the gate reopens with the same intent.
   */
  private async startStreaming(modeId: StreamingModeId): Promise<void> {
    try {
      await this.applyContinuousListeningSettings({
        ...this.continuousSettings,
        enabled: true,
        mode: modeId,
      })
    } catch (error) {
      const failure = this.microphoneDeviceService.normalizeFailure(error)
      this.recordRuntimeEvent('Streaming Runtime Start Failed', failure.reason)
      // applyContinuousListeningSettings already disabled and tore down the
      // partially started runtime. Clear the standalone error banner; the gate
      // will surface the normalized reason instead.
      this.set({ continuousListeningState: 'off', continuousListeningError: '' })
      const result = await this.microphoneGate.request(
        { type: 'start-streaming', modeId },
        'runtime-start-failed',
        failure.reason,
      )
      if (result.status === 'confirmed')
        await this.executeMicrophoneIntent(result.intent, result.deviceId)
    }
  }

  /** Begin a one-shot voice recording (device already validated by the guard). */
  private async startVoiceInput(): Promise<void> {
    await this.speechInputRuntime.toggle('idle')
  }

  /**
   * The working microphone track ended on its own during streaming. Tear the
   * runtime down cleanly and reopen the gate to recover the same mode. Never
   * auto-reconnects forever.
   */
  private async handleContinuousDeviceLost(): Promise<void> {
    if (!this.continuousSettings.enabled) return
    const modeId = this.continuousSettings.mode
    this.recordRuntimeEvent('Streaming Microphone Lost', modeId)
    await this.applyContinuousListeningSettings({ ...this.continuousSettings, enabled: false })
    this.set({ continuousListeningState: 'off', continuousListeningError: '' })
    const result = await this.microphoneGate.request(
      { type: 'start-streaming', modeId },
      'active-device-lost',
    )
    if (result.status === 'confirmed')
      await this.executeMicrophoneIntent(result.intent, result.deviceId)
  }

  // ---- microphone gate overlay actions -------------------------------------
  selectMicrophoneGateDevice(deviceId: string): void {
    this.microphoneGate.selectDevice(deviceId)
  }

  refreshMicrophoneGateDevices(): void {
    void this.microphoneGate.refreshDevices()
  }

  continueMicrophoneGate(): void {
    void this.microphoneGate.validateAndContinue()
  }

  cancelMicrophoneGate(): void {
    this.microphoneGate.cancel()
  }

  getMicrophoneGateDebug(): MicrophoneGateDebugState {
    return this.microphoneGate.getDebugState()
  }

  /** Tear down Controller-owned listeners (microphone gate, capability probing). */
  dispose(): void {
    this.microphoneGate.dispose()
    this.speechCapabilitiesRuntime.dispose()
  }

  async setContinuousListeningMode(
    mode: ContinuousListeningSettings['mode'],
  ): Promise<'applied' | 'blocked'> {
    if (this.state.microphoneGate.status !== 'closed') return 'blocked'
    await this.applyContinuousListeningSettings({ ...this.continuousSettings, mode })
    return 'applied'
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
    this.recordRuntimeEvent('Utterance Completed', chunk.completionReason)
    if (triggeredBargeIn) {
      this.recordRuntimeEvent('Barge In Utterance Finalized', `utterance=${chunk.id}`)
      this.publishControllerRuntimeEvent(
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
    const response = this.conversationRuntime.getActiveResponseSnapshot()
    if (!response.turnId || (response.phase !== 'synthesizing' && response.phase !== 'playing')) {
      return
    }

    const now = performance.now()
    const currentReply =
      [...this.state.messages].reverse().find((message) => message.role === 'assistant')?.text ?? ''
    const similarity = textSimilarity(partial.text, currentReply)
    const likelySelfEcho =
      partial.capturedDuringPlayback &&
      !isExplicitBargeInPhrase(partial.text) &&
      similarity >= bargeInTuning.selfEchoSimilarityThreshold
    const detail =
      `duration=${Math.round(partial.speechDurationMs)}ms ` +
      `confidence=${partial.confidence?.toFixed(2) ?? 'n/a'} turn=${response.turnId}`
    this.recordRuntimeEvent('Barge In Candidate', detail)
    this.publishControllerRuntimeEvent('BargeInCandidate', 'speech', detail)

    const decision = this.bargeInPolicy.evaluate({
      now,
      activeResponseId: response.turnId,
      responsePhase: response.phase,
      partialText: partial.text,
      speechDurationMs: partial.speechDurationMs,
      confidence: partial.confidence,
      capturedDuringPlayback: partial.capturedDuringPlayback,
      playbackStartedAt: response.playbackStartedAt,
      responseInterruptionPending: this.state.responseInterruptionPending,
      likelySelfEcho,
    })
    if (decision.type === 'ignore') {
      const rejectedDetail =
        decision.reason === 'self-echo'
          ? `reason=self-echo similarity=${similarity.toFixed(2)} turn=${response.turnId}`
          : `reason=${decision.reason} turn=${response.turnId}`
      this.recordRuntimeEvent('Barge In Rejected', rejectedDetail)
      this.publishControllerRuntimeEvent('BargeInRejected', 'speech', rejectedDetail)
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
    this.recordRuntimeEvent('Barge In Accepted', acceptedDetail)
    this.publishControllerRuntimeEvent('BargeInAccepted', 'speech', acceptedDetail)
    void this.interruptCurrentResponse('voice-barge-in').then((interrupted) => {
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
    const isSpeaking = this.state.status === 'speaking'
    const conversationBusy = this.conversationAdmission.isBusy() || this.state.status !== 'idle'
    const attention = this.attentionEngine.evaluate(chunk, {
      mode: this.continuousSettings.mode,
      isSpeaking,
      cooldownActive,
      recentConversation: followUpWindow,
      followUpWindow,
      curiosityChance: this.continuousSettings.curiosityChance,
    })
    this.recordRuntimeEvent(
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
    this.recordRuntimeEvent('Rule Gate Decision', `${decision.type}:${decision.reason}`)

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
      this.recordRuntimeEvent('Continuous Self Echo Suppressed', chunk.id)
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
      [...this.state.messages].reverse().find((message) => message.role === 'assistant')?.text ?? ''
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
    if (attempt.source === 'continuous_listening' || attempt.source === 'backlog_selected') {
      if (!this.continuousSettings.enabled || this.handledUtteranceIds.has(attempt.turnId)) {
        return { status: 'cancelled', turnId: attempt.turnId }
      }
      this.rememberHandledUtterance(attempt.turnId)
    }
    this.recordRuntimeEvent('Conversation Admitted', attempt.turnId)
    for (const [impulse, enabled] of [
      ['direct-address', attempt.semanticCues?.directAddress],
      ['question', attempt.semanticCues?.question],
      ['recognition-uncertain', attempt.semanticCues?.recognitionUncertain],
    ] as const) {
      if (!enabled) continue
      const triggered = this.avatarRuntime.triggerEarImpulse(impulse, attempt.turnId)
      if (triggered) {
        const current = this.shioRuntime.characterState.get()
        this.publishAvatarState({
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
      this.avatarRuntime.triggerReactionGesture('direct-address')
    else if (attempt.semanticCues?.question) this.avatarRuntime.triggerReactionGesture('question')
    if (attempt.triggeredBargeIn) {
      this.recordRuntimeEvent('Barge In Conversation Admitted', `turn=${attempt.turnId}`)
      this.publishControllerRuntimeEvent(
        'BargeInConversationAdmitted',
        'speech',
        `turn=${attempt.turnId}`,
      )
    }
    if (attempt.source !== 'debug') this.pushMessage('user', attempt.text)
    try {
      const result = await this.conversationRuntime.execute(attempt, reportPhase)
      if (attempt.source === 'continuous_listening' || attempt.source === 'backlog_selected')
        this.lastContinuousReplyAt = Date.now()
      return result
    } finally {
      this.bargeInPolicy.settleResponse(attempt.turnId)
      this.recordRuntimeEvent('Conversation Settled', attempt.turnId)
    }
  }

  private rememberHandledUtterance(id: string): void {
    this.handledUtteranceIds.add(id)
    if (this.handledUtteranceIds.size <= 64) return
    const oldest = this.handledUtteranceIds.values().next().value
    if (oldest) this.handledUtteranceIds.delete(oldest)
  }

  // ---- VRM / animation -----------------------------------------------------
  async loadVrmFromPath(
    filePath: string,
    scene: SceneManager | null = this.scene,
    version: number = this.previewSceneVersion,
  ): Promise<void> {
    if (!scene) return
    // True when the preview scene this load started with is still the current one.
    // If Preview was detached or replaced during an await, the load is stale and
    // must abort silently — it must never touch a disposed SceneManager.
    const isCurrent = (): boolean => version === this.previewSceneVersion && this.scene === scene
    try {
      const res = await window.api.vrm.read(filePath)
      if (!res.ok || !res.buffer) throw new Error(res.error ?? 'Не удалось прочитать файл')
      if (!isCurrent()) return
      await this.avatarRuntime.loadVrm(scene.scene, res.buffer)
      if (!isCurrent()) return
      const lookAtRequested = this.state.faceTrackingEnabled
      const ok = this.avatarRuntime.setLookAtTarget(
        lookAtRequested ? scene.getLookAtTarget() : null,
      )
      this.set({ faceTrackingEnabled: lookAtRequested && ok })
      this.updateCharacterState({
        status: this.state.status,
        mode: this.speechRuntime.getCharacterState().mode,
        emotion: this.speechRuntime.getCharacterState().emotion,
        vrmEmotion: this.speechRuntime.getCharacterState().avatar.vrmExpression,
        avatar: { loaded: true },
      })
      this.set({ vrmLoaded: true })
      // Frame the model to a sensible full-body size in the local Avatar Preview.
      // The overlay window owns its own camera framing via overlay presets, so it
      // must not be reframed here.
      if (!this.overlayRuntime.isOverlayWindow()) scene.frameLoadedModel()
      this.recordRuntimeEvent('VRM Loaded')
      // Keep the single mirror overlay in sync with the newly selected model.
      // Only the main window drives this; the overlay reloads itself in place,
      // so it must never re-trigger the refresh on its own boot.
      if (!this.overlayRuntime.isOverlayWindow()) {
        void window.api.overlay.reloadAvatar()
      }
    } catch (e) {
      // A load invalidated by detach/replace is an expected cancellation, not a
      // real failure — swallow it without surfacing a user-facing error.
      if (!isCurrent()) return
      this.set({ vrmLoaded: false })
      this.recordRuntimeEvent('VRM Error', String(e))
      this.pushMessage('error', `Не удалось загрузить VRM: ${String(e)}`)
    }
  }

  async loadAnimation(buffer: ArrayBuffer): Promise<void> {
    await this.avatarRuntime.loadAnimation(buffer, true)
    this.updateOverlayAnimationHudFile()
  }

  stopAnimation(): void {
    this.avatarRuntime.stopAnimation()
    this.updateOverlayAnimationHudFile()
  }

  /** Avatar Preview only: restores the front-facing full-body framing. Does not affect Overlay. */
  resetPreviewCamera(): void {
    this.scene?.resetCamera()
  }

  /**
   * Avatar Preview only: applies a camera framing preset. `full` reframes to the
   * model bounds; other presets reuse the shared overlay camera presets purely as
   * local camera positioning. Never touches Overlay or model state.
   */
  previewCameraPreset(preset: 'full' | OverlayViewMode): void {
    if (!this.scene) return
    if (preset === 'full') this.scene.frameLoadedModel()
    else this.scene.setOverlayCameraPreset(preset)
  }

  previewAvatarMode(mode: DebugAvatarMode): void {
    this.avatarRuntime.previewMode(mode)
    this.updateOverlayAnimationHudFile()
  }

  previewAvatarAnimation(id: string): void {
    this.avatarRuntime.previewAnimation(id)
    this.updateOverlayAnimationHudFile()
  }

  rerollAvatarAnimation(): void {
    this.avatarRuntime.rerollAnimation()
    this.updateOverlayAnimationHudFile()
  }

  clearAvatarAnimationCooldowns(): void {
    this.avatarRuntime.clearAnimationCooldowns()
  }

  clearAvatarAnimationQueue(): void {
    this.avatarRuntime.clearAnimationQueue()
  }

  queueAvatarTestSequence(): void {
    this.avatarRuntime.queueTestSequence()
    this.updateOverlayAnimationHudFile()
  }

  setIdleOrchestratorPaused(paused: boolean): void {
    this.avatarRuntime.setIdleOrchestratorPaused(paused)
  }

  testAvatarTransition(
    kind:
      | 'idle-to-idle'
      | 'idle-to-speaking'
      | 'speaking-to-idle'
      | 'thinking-to-idle'
      | 'greeting-to-idle',
  ): void {
    this.avatarRuntime.testTransition(kind)
    this.updateOverlayAnimationHudFile()
  }

  previewAvatarGreeting(): void {
    this.avatarRuntime.previewGreeting()
    this.updateOverlayAnimationHudFile()
  }

  previewAvatarBlink(): void {
    this.avatarRuntime.previewBlink()
  }

  setEarAxisOverride(axis: EarAxisOverride): void {
    this.avatarRuntime.setEarAxisOverride(axis)
  }

  setEarAmplitudeScale(scale: number): void {
    this.avatarRuntime.setEarAmplitudeScale(scale)
  }

  toggleFaceTracking(): void {
    if (!this.scene || !this.avatarRuntime.isLoaded()) return
    const next = !this.state.faceTrackingEnabled
    const ok = this.avatarRuntime.setLookAtTarget(next ? this.scene.getLookAtTarget() : null)
    this.set({ faceTrackingEnabled: ok ? next : false })
    void window.api.config.save({ lookAtEnabled: ok && next ? 'true' : 'false' })
    if (!this.overlayRuntime.isOverlayWindow()) void window.api.overlay.reloadAvatar()
  }

  setPassiveCompanionMode(enabled: boolean, persist = true): void {
    this.avatarRuntime.setPassiveCompanionMode(enabled)
    this.set({ passiveCompanionEnabled: enabled })
    if (persist)
      void window.api.config.save({ passiveCompanionEnabled: enabled ? 'true' : 'false' })
    if (persist && !this.overlayRuntime.isOverlayWindow()) void window.api.overlay.reloadAvatar()
    this.recordRuntimeEvent('Passive Companion Mode', enabled ? 'on' : 'off')
  }

  private subscribeActionRuntimeEvents(): void {
    if (this.unsubscribeActionEvents) return
    this.unsubscribeActionEvents = window.api.actionEvents.onPublished((event) => {
      this.shioRuntime.events.publish(event)
    })
  }

  // ---- misc ----------------------------------------------------------------
  async clearHistory(): Promise<void> {
    await window.api.memory.clear()
    this.set({ messages: [] })
    this.pushMessage('assistant', 'История очищена. Приветствую снова, путник.')
  }

  // Health probing is owned exclusively by the Speech capabilities health
  // component (single owner, no parallel probes). This delegates and lets the
  // onChange projection update both `speechCapabilities` and the legacy status dot.
  async checkHealth(): Promise<void> {
    this.speechCapabilitiesRuntime.recheck()
  }

  // Side-effect-free LLM probe: verifies the active provider is reachable and the
  // API key is accepted via the same `fetchModels` path Settings uses. It does NOT
  // call `llm.reply` (which would append to conversation memory and hold the
  // generation lock), so it never mutates conversation state.
  async checkLlmHealth(): Promise<void> {
    this.set({ llmHealth: { state: 'checking', detail: 'Проверяем доступность модели' } })
    try {
      const cfg = await window.api.config.get()
      const activeProvider = cfg.llm?.activeProvider
      const cred = activeProvider ? cfg.llm?.providers?.[activeProvider] : undefined
      const apiKey = cred?.apiKey ?? ''
      const model = cred?.model ?? ''
      if (!activeProvider) {
        this.set({ llmHealth: { state: 'unknown', detail: 'Провайдер не выбран' } })
        return
      }
      const res = await window.api.llm.fetchModels(activeProvider, apiKey)
      if (res.ok) {
        this.set({ llmHealth: { state: 'ok', detail: model || 'Провайдер доступен' } })
        return
      }
      if (res.kind === 'auth') {
        this.set(
          apiKey.trim()
            ? { llmHealth: { state: 'error', detail: 'Ошибка аутентификации' } }
            : { llmHealth: { state: 'unknown', detail: 'Не указан API-ключ' } },
        )
        return
      }
      this.set({ llmHealth: { state: 'error', detail: 'Провайдер недоступен' } })
    } catch {
      this.set({ llmHealth: { state: 'error', detail: 'Не удалось проверить провайдера' } })
    }
  }
}

export const controller = new Controller()

// This module owns imperative Three.js/audio singletons that can't be hot-swapped.
// Force a full page reload on change so we never end up with a split-brain
// controller (one rendering the scene, another that React subscribes to).
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload()
  })
}
