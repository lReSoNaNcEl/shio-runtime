import {
  type CharacterEmbodimentIntent,
  normalizeCharacterEmbodimentIntent,
} from '../../shared/character-response'
import { type BodyPresentation, bodyPresentationProjectionSchema } from '../../shared/motion'
import type { EarImpulse } from '../avatar/embodiment/secondary-motion/EarBehaviorRuntime'
import type { MouthWeights } from '../avatar/embodiment/speech/LipSync'
import type { SceneManager } from '../avatar/rendering/three/SceneManager'
import type { OverlayViewMode } from '../avatar/tuning/cameraTuning'
import { observeRendererPromise } from '../reliability/observePromise'
import type { AvatarMode } from './AvatarRuntime'

export interface SyncedAvatarState {
  mode: AvatarMode
  emotionKey?: string
  speechDeliveryEmotion?: string | null
  vrmEmotion?: string
  reaction?: 'user-interruption'
  reactionId?: string
  earImpulse?: EarImpulse
  earImpulseId?: string
  embodimentIntent?: CharacterEmbodimentIntent
  behaviorEmbodimentIntent?: CharacterEmbodimentIntent
  browserScreenGazeSessionId?: string
  browserScreenGazeActive?: boolean
}

/**
 * The overlay only needs a few string-valued settings. This structural view is
 * satisfied both by the full persisted settings object (from config:get) and
 * by the string map delivered via overlay-settings updates.
 */
export interface OverlaySettingsView {
  overlayWidth?: string
  overlayHeight?: string
  vrmAssetHandle?: string
  overlayTransparentBackground?: string
  overlayScale?: string
  overlayViewMode?: string
  developerModeEnabled?: string
  developerOverlayAnimationHudEnabled?: string
}

export interface OverlayRemoteHandlers {
  bodyPose?: (value: BodyPresentation | null) => void
  avatarState?: (state: SyncedAvatarState) => void
  mouthWeights?: (weights: MouthWeights) => void
  settings?: (cfg: OverlaySettingsView) => void
}

export class OverlayRuntime {
  private readonly overlayWindow =
    new URLSearchParams(window.location.search).get('overlay') === '1'
  private mouthPublishTimer = 0
  private bodyPublishTimer = 0
  private bodyPublished = false
  private bodyPublishInFlight = false
  private bodyReleaseInFlight = false
  private pendingBodyPose: BodyPresentation | null | undefined
  private bodyPublisherStopped = false
  private modelAssetHandle = ''
  private lastMouthPublishSpeaking = false
  private lastMirrorLipSyncLogAt = 0
  private remoteUnsubscribers: Array<() => void> = []

  isOverlayWindow(): boolean {
    return this.overlayWindow
  }

  runtimeAttachedLabel(): string {
    return this.overlayWindow ? 'Overlay Runtime Attached' : 'Runtime Attached'
  }

  async getDebugState(): Promise<string> {
    if (this.overlayWindow) return 'overlay-window'

    try {
      const overlay = await window.api.overlay.isVisible()
      return overlay.visible ? 'visible' : 'hidden'
    } catch {
      return 'unknown'
    }
  }

  applySettings(scene: SceneManager | null, cfg: OverlaySettingsView): void {
    if (!this.overlayWindow) return
    if (cfg.vrmAssetHandle !== undefined) this.modelAssetHandle = cfg.vrmAssetHandle
    const transparentBackground = cfg.overlayTransparentBackground !== 'false'
    document.documentElement.classList.toggle('overlay-solid-background', !transparentBackground)
    document.body.classList.toggle('overlay-solid-background', !transparentBackground)
    if (!scene) return
    scene.setTransparentBackground(transparentBackground)
    const scale = Number(cfg.overlayScale ?? '1')
    const mode = this.parseOverlayViewMode(cfg.overlayViewMode)
    scene.setOverlayCameraPreset(mode, Number.isFinite(scale) ? scale : 1)
  }

  async loadInitialRemoteState(): Promise<{
    avatarState: SyncedAvatarState | null
    mouthWeights: MouthWeights | null
    bodyPose: BodyPresentation | null
  }> {
    if (!this.overlayWindow) return { avatarState: null, mouthWeights: null, bodyPose: null }

    const [avatarState, mouthWeights, bodyPose] = await Promise.all([
      window.overlayApi.avatarState.get(),
      window.overlayApi.avatarMouth.get(),
      window.overlayApi.avatarBody.get(),
    ])

    return {
      avatarState: this.parseAvatarState(avatarState),
      mouthWeights: this.parseMouthWeights(mouthWeights),
      bodyPose: this.parseBodyPose(bodyPose),
    }
  }

  subscribeToRemoteUpdates(handlers: OverlayRemoteHandlers): void {
    if (!this.overlayWindow) return
    this.disposeRemoteSubscriptions()

    this.remoteUnsubscribers = [
      window.overlayApi.avatarBody.onUpdated((value) => {
        handlers.bodyPose?.(this.parseBodyPose(value))
      }),
      window.overlayApi.avatarState.onUpdated((state) => {
        const parsed = this.parseAvatarState(state)
        if (parsed) handlers.avatarState?.(parsed)
      }),
      window.overlayApi.avatarMouth.onUpdated((weights) => {
        const parsed = this.parseMouthWeights(weights)
        if (parsed) {
          this.logMirrorLipSync('mirror', parsed, 'ipc-receive')
          handlers.mouthWeights?.(parsed)
        }
      }),
      window.overlayApi.config.onUpdated((cfg) => {
        handlers.settings?.(cfg)
      }),
    ]
  }

  dispose(): void {
    if (!this.bodyPublisherStopped) {
      this.bodyPublisherStopped = true
      const needsRelease =
        this.bodyPublished ||
        this.pendingBodyPose === null ||
        (this.bodyPublishInFlight && !this.bodyReleaseInFlight)
      this.pendingBodyPose = needsRelease && !this.bodyReleaseInFlight ? null : undefined
      this.bodyPublished = false
      this.flushBodyPublication()
    }
    this.disposeRemoteSubscriptions()
  }

  publishAvatarState(state: SyncedAvatarState): void {
    if (this.overlayWindow) return
    observeRendererPromise(window.api.avatarState.publish(state), 'publish Overlay avatar state')
  }

  publishBodyFrame(delta: number, value: BodyPresentation | null): void {
    if (this.overlayWindow || this.bodyPublisherStopped) return
    this.bodyPublishTimer += Math.max(0, delta)
    const interval = 1 / 30
    if (value && this.bodyPublishTimer < interval) return
    if (!value && !this.bodyPublished) return
    this.bodyPublishTimer = value ? this.bodyPublishTimer % interval : 0
    this.bodyPublished = value !== null
    this.pendingBodyPose = value
    this.flushBodyPublication()
  }

  private flushBodyPublication(): void {
    if (
      (this.bodyPublisherStopped && this.pendingBodyPose !== null) ||
      this.bodyPublishInFlight ||
      this.pendingBodyPose === undefined
    )
      return
    const value = this.pendingBodyPose
    this.pendingBodyPose = undefined
    this.bodyPublishInFlight = true
    this.bodyReleaseInFlight = value === null
    observeRendererPromise(this.publishBodyPose(value), 'publish Overlay body pose')
  }

  private async publishBodyPose(value: BodyPresentation | null): Promise<void> {
    try {
      await window.api.avatarBody.publish(value)
    } finally {
      this.bodyPublishInFlight = false
      this.bodyReleaseInFlight = false
      this.flushBodyPublication()
    }
  }

  private parseBodyPose(value: unknown): BodyPresentation | null {
    const parsed = bodyPresentationProjectionSchema.safeParse(value)
    if (!parsed.success || parsed.data.modelAssetHandle !== this.modelAssetHandle) return null
    const { modelAssetHandle: _assetHandle, ...pose } = parsed.data
    return pose
  }

  publishMouthWeightsFrame(delta: number, speaking: boolean, weights: MouthWeights): void {
    if (this.overlayWindow) return
    this.mouthPublishTimer += delta
    if (this.mouthPublishTimer < 1 / 30) return
    this.mouthPublishTimer = 0

    const releaseActive =
      !speaking && Math.max(weights.aa, weights.ih, weights.ou, weights.ee, weights.oh) > 0.001
    if (!speaking && !releaseActive) {
      if (!this.lastMouthPublishSpeaking) return
      this.lastMouthPublishSpeaking = false
      const closed = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }
      this.logMirrorLipSync('main', closed, 'ipc-publish-stop')
      observeRendererPromise(
        window.api.avatarMouth.publish(closed),
        'publish Overlay mouth release',
      )
      return
    }

    this.lastMouthPublishSpeaking = true
    this.logMirrorLipSync('main', weights, releaseActive ? 'ipc-publish-release' : 'ipc-publish')
    observeRendererPromise(window.api.avatarMouth.publish(weights), 'publish Overlay mouth weights')
  }

  private disposeRemoteSubscriptions(): void {
    for (const unsubscribe of this.remoteUnsubscribers.splice(0)) unsubscribe()
  }

  private parseAvatarState(state: unknown): SyncedAvatarState | null {
    if (!state || typeof state !== 'object') return null
    const value = state as Partial<SyncedAvatarState>
    if (
      value.mode !== 'idle' &&
      value.mode !== 'listening' &&
      value.mode !== 'thinking' &&
      value.mode !== 'awaitingSpeech' &&
      value.mode !== 'speaking'
    ) {
      return null
    }
    return {
      mode: value.mode,
      speechDeliveryEmotion:
        typeof value.speechDeliveryEmotion === 'string' ? value.speechDeliveryEmotion : null,
      emotionKey: typeof value.emotionKey === 'string' ? value.emotionKey : undefined,
      vrmEmotion: typeof value.vrmEmotion === 'string' ? value.vrmEmotion : undefined,
      reaction: value.reaction === 'user-interruption' ? value.reaction : undefined,
      reactionId: typeof value.reactionId === 'string' ? value.reactionId : undefined,
      earImpulse:
        value.earImpulse === 'user-interruption' ||
        value.earImpulse === 'direct-address' ||
        value.earImpulse === 'question' ||
        value.earImpulse === 'thinking-entry' ||
        value.earImpulse === 'reply-emphasis' ||
        value.earImpulse === 'recognition-uncertain'
          ? value.earImpulse
          : undefined,
      earImpulseId: typeof value.earImpulseId === 'string' ? value.earImpulseId : undefined,
      embodimentIntent: normalizeCharacterEmbodimentIntent(value.embodimentIntent),
      behaviorEmbodimentIntent: normalizeCharacterEmbodimentIntent(value.behaviorEmbodimentIntent),
      browserScreenGazeSessionId:
        typeof value.browserScreenGazeSessionId === 'string'
          ? value.browserScreenGazeSessionId
          : undefined,
      browserScreenGazeActive:
        typeof value.browserScreenGazeActive === 'boolean'
          ? value.browserScreenGazeActive
          : undefined,
    }
  }

  private parseMouthWeights(weights: unknown): MouthWeights | null {
    if (!weights || typeof weights !== 'object') return null
    const value = weights as Partial<MouthWeights>
    return {
      aa: this.clampWeight(value.aa),
      ih: this.clampWeight(value.ih),
      ou: this.clampWeight(value.ou),
      ee: this.clampWeight(value.ee),
      oh: this.clampWeight(value.oh),
    }
  }

  private parseOverlayViewMode(mode: unknown): OverlayViewMode {
    if (mode === 'bust' || mode === 'face' || mode === 'portrait') return mode
    return 'bust'
  }

  private clampWeight(value: unknown): number {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 0
    return Math.max(0, Math.min(1, numeric))
  }

  private logMirrorLipSync(model: 'main' | 'mirror', weights: MouthWeights, phase: string): void {
    const now = performance.now()
    const max = Math.max(weights.aa, weights.ih, weights.ou, weights.ee, weights.oh)
    if (max <= 0.01 && now - this.lastMirrorLipSyncLogAt < 1000) return
    if (max > 0.01 && now - this.lastMirrorLipSyncLogAt < 250) return
    this.lastMirrorLipSyncLogAt = now
    console.log(
      `[MIRROR-LIPSYNC] model=${model} phase=${phase} ` +
        `aa=${weights.aa.toFixed(3)} ih=${weights.ih.toFixed(3)} ou=${weights.ou.toFixed(3)} ` +
        `ee=${weights.ee.toFixed(3)} oh=${weights.oh.toFixed(3)} max=${max.toFixed(3)}`,
    )
  }
}
