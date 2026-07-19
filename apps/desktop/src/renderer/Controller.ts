import type { TranslationKey } from '../shared/localization'
import {
  DEFAULT_UI_LOCALE,
  normalizeUiLocale,
  type TranslationParams,
  translate,
  type UiLocale,
} from '../shared/localization'
import type {
  CharacterRuntimeMode,
  CharacterState,
  RuntimeEventCategory,
  RuntimeEventType,
} from '../shared/runtime'
import type { SerializedSpeechError } from '../shared/speech'
import { AudioPlayer } from './audio/audioPlayer'
import { MicrophoneDeviceService } from './audio/MicrophoneDeviceService'
import { MicrophoneGateController } from './audio/MicrophoneGateController'
import {
  CLOSED_GATE,
  isDefaultMicrophone,
  type MicrophoneGateDebugState,
} from './audio/microphoneGateTypes'
import type { DebugAvatarMode } from './avatar/avatarAnimations'
import type { EarAxisOverride } from './avatar/embodiment/secondary-motion/EarBehaviorRuntime'
import type { MouthWeights } from './avatar/embodiment/speech/LipSync'
import { SceneManager } from './avatar/rendering/three/SceneManager'
import type { OverlayViewMode } from './avatar/tuning/cameraTuning'
import { type ControllerStateListener, ControllerStore } from './controller/ControllerStore'
import type {
  AppStatus,
  ChatMsg,
  ControllerState,
  HealthState,
  RuntimeDebugSnapshot,
} from './controller/contracts'
import { RuntimeDiagnosticsProjection } from './controller/RuntimeDiagnosticsProjection'
import { type AvatarMode, AvatarRuntime } from './runtime/AvatarRuntime'
import { ConversationPresenceRuntime } from './runtime/ConversationPresenceRuntime'
import { ConversationRuntime } from './runtime/ConversationRuntime'
import {
  OverlayRuntime,
  type OverlaySettingsView,
  type SyncedAvatarState,
} from './runtime/OverlayRuntime'
import { ShioRuntime } from './runtime/ShioRuntime'
import { SpeechCapabilitiesRuntime } from './runtime/SpeechCapabilitiesRuntime'
import { SpeechInputRuntime } from './runtime/SpeechInputRuntime'
import { SpeechRuntime } from './runtime/SpeechRuntime'
import {
  INITIAL_SPEECH_CAPABILITIES,
  type SpeechCapabilitiesState,
} from './runtime/speechCapabilities'
import {
  defaultContinuousListeningSettings,
  parseAttentionMode,
  parseTunedNumber,
} from './speech/continuous-listening/tuning'
import type { ContinuousListeningSettings } from './speech/continuous-listening/types'
import { ConversationInputCoordinator } from './speech/conversation/ConversationInputCoordinator'

export type {
  AppStatus,
  ChatMsg,
  ControllerState,
  HealthState,
  RuntimeDebugSnapshot,
  RuntimeTimelineEvent,
} from './controller/contracts'
export { STATUS_LABELS } from './controller/contracts'

type SpeechReply = Awaited<ReturnType<Window['api']['tts']['synthesizeReply']>>

let idSeq = 0
const nextId = (): string => `m${++idSeq}`
export class Controller {
  private uiLocale: UiLocale = DEFAULT_UI_LOCALE
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
  private speechInputRuntime = new SpeechInputRuntime({
    speechRuntime: this.speechRuntime,
    avatarRuntime: this.avatarRuntime,
    overlayRuntime: this.overlayRuntime,
    events: this.shioRuntime.events,
    setStatus: (status) => this.set({ status }),
    pushMessage: (role, text) => this.pushMessage(role, text),
    formatMicrophoneUnavailable: (error) => this.t('speechInput.microphoneUnavailable', { error }),
    emptyRecordingMessage: () => this.t('speechInput.emptyRecording'),
    recordRuntimeEvent: (label, detail) => this.recordRuntimeEvent(label, detail),
    reportSpeechServiceError: (error) => this.reportSpeechServiceError(error),
    updateCharacterState: (patch) => this.updateCharacterState(patch),
  })
  private microphoneDeviceService = new MicrophoneDeviceService((index) =>
    this.t('microphone.fallback', { index }),
  )
  private microphoneGate = new MicrophoneGateController({
    service: this.microphoneDeviceService,
    getSavedDeviceId: () => this.speechInputRuntime.getMicrophoneId(),
    onStateChange: (microphoneGate) => this.set({ microphoneGate }),
    recordEvent: (label, detail) => this.recordRuntimeEvent(label, detail),
  })
  private store = new ControllerStore({
    status: 'idle',
    responseInterruptionPending: false,
    messages: [],
    health: { state: 'checking', text: translate(DEFAULT_UI_LOCALE, 'common.checkingEllipsis') },
    speechCapabilities: INITIAL_SPEECH_CAPABILITIES,
    llmHealth: { state: 'unknown', detail: translate(DEFAULT_UI_LOCALE, 'common.notChecked') },
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
  })
  private diagnostics = new RuntimeDiagnosticsProjection({
    getControllerState: () => this.store.getState(),
    getCharacterState: () => this.getCharacterStateSnapshot(),
    getAvatarDebugState: () => this.avatarRuntime.getDebugState(),
    getPlaybackDebug: () => this.player.getPlaybackDebug(),
    getOverlayDebugState: () => this.overlayRuntime.getDebugState(),
    getEventHistory: () => this.shioRuntime.events.getHistory(),
    getSpeechTimeline: () => this.speechRuntime.getSpeechTimeline(),
    getMicrophoneGateDebug: () => this.microphoneGate.getDebugState(),
    isAvatarLoaded: () => this.avatarRuntime.isLoaded(),
    createId: () => nextId(),
    now: () => Date.now(),
    performanceNow: () => performance.now(),
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
    formatUserError: (message) => this.formatConversationUserError(message),
    markAssistantMessageInterrupted: () => this.markAssistantMessageInterrupted(),
    setResponseInterruptionPending: (pending) => this.set({ responseInterruptionPending: pending }),
    recordRuntimeEvent: (label, detail) => this.recordRuntimeEvent(label, detail),
    reportSpeechServiceError: (error) => this.reportSpeechServiceError(error),
    updateCharacterState: (patch) => this.updateCharacterState(patch),
    rememberSpeechMetadata: (speech) => this.rememberSpeechMetadata(speech),
    updateSpeechPlaybackProgress: (progress) => this.updateSpeechPlaybackProgress(progress),
    isContinuousCaptureAlive: () => this.speechInputRuntime.isContinuousCaptureAlive(),
  })
  private conversationInput = new ConversationInputCoordinator({
    speechInputRuntime: this.speechInputRuntime,
    conversationRuntime: this.conversationRuntime,
    microphoneGate: this.microphoneGate,
    avatarRuntime: this.avatarRuntime,
    getControllerState: () => this.store.getState(),
    getCharacterState: () => this.shioRuntime.characterState.get(),
    patchControllerState: (patch) => this.set(patch),
    pushMessage: (role, text) => this.pushMessage(role, text),
    recordRuntimeEvent: (label, detail) => this.recordRuntimeEvent(label, detail),
    publishRuntimeEvent: (type, category, detail) =>
      this.publishControllerRuntimeEvent(type, category, detail),
    publishAvatarState: (state) => this.publishAvatarState(state),
    getConfig: () => window.api.config.get(),
    saveConfig: (patch) => window.api.config.save(patch),
    arbitrateBacklog: (request) => window.api.llm.arbitrateBacklog(request),
    normalizeMicrophoneFailure: (error) => this.microphoneDeviceService.normalizeFailure(error),
    getMicrophoneAccessFailedMessage: () => this.t('controller.microphoneAccessFailed'),
    createTurnId: (prefix) => `${prefix}-${nextId()}`,
  })

  private overlayCommand: Promise<void> = Promise.resolve()
  private overlayDesired: boolean | null = null
  private unsubscribeActionEvents: (() => void) | null = null
  private actionRuntimeBoundary = { process: 'main', source: 'main.actionRuntime' }
  // Dedup for the one-per-incident "показан текстом" note while TTS is down.
  private lastSynthesisNoticeIncidentId = 0
  private frameCounter = 0
  private bootstrapped = false
  private avatarTickRafId: number | null = null
  private avatarTickLastTime = 0
  private llmHealthDetailKey: TranslationKey | null = 'common.notChecked'

  private get state(): ControllerState {
    return this.store.getState()
  }

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

  private t(key: TranslationKey, params?: TranslationParams): string {
    return translate(this.uiLocale, key, params)
  }

  private formatConversationUserError(message: string): string {
    const screenContextErrors: Record<string, TranslationKey> = {
      VISION_UNSUPPORTED: 'screenContext.error.visionUnsupported',
      PERMISSION_DENIED: 'screenContext.error.permissionDenied',
      NO_SOURCES: 'screenContext.error.noSources',
      SOURCE_NOT_FOUND: 'screenContext.error.sourceNotFound',
      CAPTURE_EMPTY: 'screenContext.error.captureEmpty',
      CAPTURE_TOO_LARGE: 'screenContext.error.captureTooLarge',
      CAPTURE_EXPIRED: 'screenContext.error.captureExpired',
      CAPTURE_NOT_OWNED: 'screenContext.error.captureNotOwned',
      UNKNOWN: 'screenContext.error.unknown',
    }
    if (message === 'SCREEN_CONTEXT_PROVIDER_REJECTED') {
      return this.t('conversation.userError', {
        message: this.t('screenContext.error.providerRejected'),
      })
    }
    const code = message.startsWith('SCREEN_CONTEXT_ERROR:')
      ? message.slice('SCREEN_CONTEXT_ERROR:'.length)
      : ''
    const key = screenContextErrors[code]
    return this.t('conversation.userError', {
      message: key ? this.t(key) : message,
    })
  }

  private applyUiLocale(locale: UiLocale): void {
    this.uiLocale = locale
    const patch: Partial<ControllerState> = {
      health: this.toLegacyHealth(this.state.speechCapabilities),
    }
    if (this.llmHealthDetailKey) {
      patch.llmHealth = {
        ...this.state.llmHealth,
        detail: this.t(this.llmHealthDetailKey),
      }
    }
    if (this.state.continuousListeningState === 'error') {
      patch.continuousListeningError = this.t('controller.microphoneAccessFailed')
    }
    this.set(patch)
  }

  private setLlmHealth(
    state: ControllerState['llmHealth']['state'],
    detail: TranslationKey | { raw: string },
  ): void {
    this.llmHealthDetailKey = typeof detail === 'string' ? detail : null
    this.set({
      llmHealth: {
        state,
        detail: typeof detail === 'string' ? this.t(detail) : detail.raw,
      },
    })
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
        this.pushMessage('meta', this.t('controller.synthesisTextFallback'))
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
        return { state: 'warn', text: this.t('controller.health.degraded') }
      case 'unavailable':
        return { state: 'err', text: this.t('controller.health.unavailable') }
      default:
        return { state: 'checking', text: this.t('common.checkingEllipsis') }
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
    this.conversationInput.handleStreamingServiceLost(_error)
  }

  // ---- observable plumbing -------------------------------------------------
  subscribe(listener: ControllerStateListener): () => void {
    return this.store.subscribe(listener)
  }

  getState(): ControllerState {
    return this.store.getState()
  }

  private set(patch: Partial<ControllerState>): void {
    this.store.patch(patch)
  }

  private pushMessage(role: ChatMsg['role'], text: string): void {
    this.store.appendMessage({ id: nextId(), role, text })
  }

  private markAssistantMessageInterrupted(): void {
    this.store.markLatestAssistantInterrupted()
  }

  interruptCurrentResponse(source: 'manual-stop' | 'voice-barge-in'): Promise<boolean> {
    return this.conversationRuntime.interruptCurrentResponse(source)
  }

  private recordRuntimeEvent(label: string, detail?: string): void {
    this.diagnostics.record(label, detail)
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
    return this.diagnostics.getSnapshot()
  }

  // ---- lifecycle -----------------------------------------------------------
  async bootstrap(): Promise<void> {
    if (this.bootstrapped) return
    this.bootstrapped = true
    this.subscribeActionRuntimeEvents()
    this.publishControllerRuntimeEvent('RuntimeInitialized', 'system')
    this.recordRuntimeEvent(this.overlayRuntime.runtimeAttachedLabel())
    const cfg = await window.api.config.get()
    this.applyUiLocale(normalizeUiLocale(cfg.uiLocale))
    await this.checkHealth()
    void this.checkLlmHealth()
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
    window.api.config.onUpdated((updated) => {
      this.applyOverlayConfigProjection(updated)
      this.applyUiLocale(normalizeUiLocale(updated.uiLocale))
    })
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
        overlayError: this.t('controller.overlay.applyFailed', { mode }),
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
          overlayError: desired
            ? this.t('controller.overlay.openFailed')
            : this.t('controller.overlay.closeFailed'),
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
      this.diagnostics.evaluateInvariants({
        frame: this.frameCounter,
        now: performance.now(),
      })
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
    const overlayAnimationHudEnabled =
      cfg.developerModeEnabled === 'true' && cfg.developerOverlayAnimationHudEnabled !== 'false'
    this.set({
      overlayAnimationHudEnabled,
      overlayAnimationFile: overlayAnimationHudEnabled ? this.state.overlayAnimationFile : '',
    })
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
    if (!this.overlayRuntime.isOverlayWindow() || !this.state.overlayAnimationHudEnabled) {
      if (this.state.overlayAnimationFile) this.set({ overlayAnimationFile: '' })
      return
    }
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

  private rememberSpeechMetadata(speech: SpeechReply): void {
    this.diagnostics.rememberSpeechMetadata(speech)
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
      .map((d) => ({ deviceId: d.deviceId, label: d.label || this.t('microphone.generic') }))
  }

  setMicrophone(deviceId: string): void {
    this.speechInputRuntime.setMicrophone(deviceId)
  }

  getMicrophoneId(): string {
    return this.speechInputRuntime.getMicrophoneId()
  }

  // ---- chat cycle ----------------------------------------------------------
  async sendText(text: string, screenContextId?: string): Promise<void> {
    await this.conversationInput.admitText(text, screenContextId)
  }

  async runDebugFullRuntimeTest(emotionKey = 'happy'): Promise<void> {
    const outcome = await this.conversationInput.admitDebug(emotionKey)
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
      await this.conversationInput.admitPushToTalk(recognized.text)
      return
    }
    if (this.state.status !== 'idle') return
    // Starting voice input runs the same blocking microphone guard as streaming;
    // only the intent (and gate copy) differ.
    const result = await this.microphoneGate.request(
      { type: 'start-voice-input' },
      'not-configured',
    )
    if (result.status === 'confirmed') {
      this.speechInputRuntime.setMicrophone(
        isDefaultMicrophone(result.deviceId) ? '' : result.deviceId,
      )
      await this.startVoiceInput()
    }
  }

  async applyContinuousListeningSettings(
    settings: ContinuousListeningSettings,
    persist = true,
  ): Promise<void> {
    await this.conversationInput.applyContinuousSettings(settings, persist)
  }

  async toggleContinuousListening(): Promise<void> {
    await this.conversationInput.toggleContinuousListening()
  }

  /** Begin a one-shot voice recording (device already validated by the guard). */
  private async startVoiceInput(): Promise<void> {
    await this.speechInputRuntime.toggle('idle')
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
    await this.applyContinuousListeningSettings({ ...this.conversationInput.getSettings(), mode })
    return 'applied'
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
      if (!res.ok || !res.buffer) throw new Error(res.error ?? this.t('controller.fileReadFailed'))
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
      this.pushMessage('error', this.t('controller.vrmLoadFailed', { error: String(e) }))
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
    this.store.clearMessages()
    this.pushMessage('assistant', this.t('controller.historyCleared'))
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
    this.setLlmHealth('checking', 'controller.llm.checking')
    try {
      const cfg = await window.api.config.get()
      const activeProvider = cfg.llm?.activeProvider
      const cred = activeProvider ? cfg.llm?.providers?.[activeProvider] : undefined
      const apiKey = cred?.apiKey ?? ''
      const model = cred?.model ?? ''
      if (!activeProvider) {
        this.setLlmHealth('unknown', 'controller.llm.providerMissing')
        return
      }
      const res = await window.api.llm.fetchModels(activeProvider, apiKey)
      if (res.ok) {
        this.setLlmHealth('ok', model ? { raw: model } : 'controller.llm.providerAvailable')
        return
      }
      if (res.kind === 'auth') {
        this.setLlmHealth(
          apiKey.trim() ? 'error' : 'unknown',
          apiKey.trim() ? 'controller.llm.authError' : 'controller.llm.keyMissing',
        )
        return
      }
      this.setLlmHealth('error', 'controller.llm.unavailable')
    } catch {
      this.setLlmHealth('error', 'controller.llm.checkFailed')
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
