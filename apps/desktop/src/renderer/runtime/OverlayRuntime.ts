import {
  type CharacterEmbodimentIntent,
  normalizeCharacterEmbodimentIntent,
} from '../../shared/character-response'
import type { EarImpulse } from '../avatar/embodiment/secondary-motion/EarBehaviorRuntime'
import type { MouthWeights } from '../avatar/embodiment/speech/LipSync'
import type { SceneManager } from '../avatar/rendering/three/SceneManager'
import type { OverlayViewMode } from '../avatar/tuning/cameraTuning'
import { observeRendererPromise } from '../reliability/observePromise'
import type { AvatarMode } from './AvatarRuntime'

export interface SyncedAvatarState {
  mode: AvatarMode
  emotionKey?: string
  vrmEmotion?: string
  reaction?: 'user-interruption'
  reactionId?: string
  earImpulse?: EarImpulse
  earImpulseId?: string
  embodimentIntent?: CharacterEmbodimentIntent
  behaviorEmbodimentIntent?: CharacterEmbodimentIntent
  gameScreenGazeSessionId?: string
  gameScreenGazeActive?: boolean
}

/**
 * The overlay only needs a few string-valued settings. This structural view is
 * satisfied both by the full persisted settings object (from config:get) and
 * by the string map delivered via overlay-settings updates.
 */
export interface OverlaySettingsView {
  overlayTransparentBackground?: string
  overlayScale?: string
  overlayViewMode?: string
  developerModeEnabled?: string
  developerOverlayAnimationHudEnabled?: string
}

export interface OverlayRemoteHandlers {
  avatarState?: (state: SyncedAvatarState) => void
  mouthWeights?: (weights: MouthWeights) => void
  settings?: (cfg: OverlaySettingsView) => void
}

export class OverlayRuntime {
  private readonly overlayWindow =
    new URLSearchParams(window.location.search).get('overlay') === '1'
  private mouthPublishTimer = 0
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
  }> {
    if (!this.overlayWindow) return { avatarState: null, mouthWeights: null }

    const [avatarState, mouthWeights] = await Promise.all([
      window.overlayApi.avatarState.get(),
      window.overlayApi.avatarMouth.get(),
    ])

    return {
      avatarState: this.parseAvatarState(avatarState),
      mouthWeights: this.parseMouthWeights(mouthWeights),
    }
  }

  subscribeToRemoteUpdates(handlers: OverlayRemoteHandlers): void {
    if (!this.overlayWindow) return
    this.disposeRemoteSubscriptions()

    this.remoteUnsubscribers = [
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
    this.disposeRemoteSubscriptions()
  }

  publishAvatarState(state: SyncedAvatarState): void {
    if (this.overlayWindow) return
    observeRendererPromise(window.api.avatarState.publish(state), 'publish Overlay avatar state')
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
      gameScreenGazeSessionId:
        typeof value.gameScreenGazeSessionId === 'string'
          ? value.gameScreenGazeSessionId
          : undefined,
      gameScreenGazeActive:
        typeof value.gameScreenGazeActive === 'boolean' ? value.gameScreenGazeActive : undefined,
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
