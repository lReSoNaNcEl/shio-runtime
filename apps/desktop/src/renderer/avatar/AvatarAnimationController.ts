import { type AnimationId, getAnimation } from './animationManifest'
import type { AvatarBodyMotionLayer } from './embodiment/motion/AvatarMotionLayer'
import type { AvatarBodyActionDebugState, AvatarModel } from './rendering/two/AvatarModel'

export type AnimationPlaybackStatus = 'idle' | 'loading' | 'playing' | 'failed'

export interface AnimationControllerDebugState {
  /** Semantic key or manifest id currently playing. */
  activeAnimationId: string | null
  /** Semantic key or manifest id most recently requested. */
  requestedAnimationId: string | null
  previousAnimationId: string | null
  activeFileName: string | null
  requestedFileName: string | null
  loop: boolean
  playbackStatus: AnimationPlaybackStatus
  lastBlendDuration: number
  isPlaybackActive: boolean
  bodyActions: AvatarBodyActionDebugState
  failedAnimationIds: string[]
}

export interface PlayManifestOptions {
  fallbackId?: AnimationId
  blendDuration?: number
  forceReplay?: boolean
  requestSource?: string
  requestReason?: string
  behaviorId?: string
  frame?: number
  previousAnimationId?: string | null
  motionLayer?: AvatarBodyMotionLayer
}

export class AvatarAnimationController {
  private activeAnimationId: string | null = null
  private requestedAnimationId: string | null = null
  private previousAnimationId: string | null = null
  private activeFileName: string | null = null
  private requestedFileName: string | null = null
  private loop = false
  private lastBlendDuration = 0.3
  private playbackStatus: AnimationPlaybackStatus = 'idle'
  private failedIds = new Set<string>()
  private requestId = 0
  private latestPlaybackRequest: Promise<void> = Promise.resolve()

  constructor(private avatarModel: AvatarModel) {}

  stop(): void {
    this.requestId += 1
    this.activeAnimationId = null
    this.requestedAnimationId = null
    this.previousAnimationId = null
    this.activeFileName = null
    this.requestedFileName = null
    this.loop = false
    this.playbackStatus = 'idle'
    this.avatarModel.stopAnimation()
  }

  /**
   * Play a specific manifest animation directly by id (debug/preview path).
   * Bypasses the semantic pools and plays exactly the requested clip.
   */
  async playManifest(
    id: string,
    loop: boolean,
    fallbackId?: AnimationId,
    blendDuration?: number,
  ): Promise<void>
  async playManifest(id: string, loop: boolean, options?: PlayManifestOptions): Promise<void>
  playManifest(
    id: string,
    loop: boolean,
    fallbackOrOptions?: AnimationId | PlayManifestOptions,
    legacyBlendDuration = 0.3,
  ): Promise<void> {
    const options: PlayManifestOptions =
      typeof fallbackOrOptions === 'object' && fallbackOrOptions !== null
        ? fallbackOrOptions
        : { fallbackId: fallbackOrOptions, blendDuration: legacyBlendDuration }
    const request = this.executeManifestRequest(id, loop, options)
    this.latestPlaybackRequest = request
    return request
  }

  async waitForLatestPlaybackRequest(timeoutMs: number): Promise<boolean> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const settled = (async (): Promise<boolean> => {
      while (true) {
        const request = this.latestPlaybackRequest
        await request.catch(() => undefined)
        if (request === this.latestPlaybackRequest) break
      }
      return this.playbackStatus === 'playing' && this.avatarModel.isAnimationPlaying()
    })()
    const timeout = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), Math.max(0, timeoutMs))
    })
    try {
      return await Promise.race([settled, timeout])
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId)
    }
  }

  private async executeManifestRequest(
    id: string,
    loop: boolean,
    options: PlayManifestOptions,
  ): Promise<void> {
    const fallbackId = options.fallbackId
    const blendDuration = options.blendDuration ?? 0.3
    const forceReplay = options.forceReplay ?? false
    const entry = getAnimation(id)
    const url = entry?.file
    this.requestedAnimationId = id
    this.requestedFileName = entry?.file ?? null
    this.loop = loop
    this.lastBlendDuration = blendDuration

    // Re-selecting the currently-active looping clip must NOT restart it. Reloading
    // would reset the action to t=0 and crossfade, producing a visible jerk / hip
    // pop ("falls from the ceiling"). Keep the already-playing loop as-is. This is
    // exactly what happens when the idle orchestrator re-picks the current pose.
    if (
      !forceReplay &&
      loop &&
      this.activeAnimationId === id &&
      this.avatarModel.isAnimationPlaying()
    ) {
      this.playbackStatus = 'playing'
      console.log(
        `[PLAYBACKREQ] final guard ignored already-active loop "${id}" source=${options.requestSource ?? 'unknown'}`,
      )
      return
    }

    if (!this.avatarModel.isLoaded() || !entry || !url) {
      if (entry && !url) this.failedIds.add(id)
      this.playbackStatus = entry && !url ? 'failed' : this.playbackStatus
      if (fallbackId && fallbackId !== id)
        await this.playManifest(fallbackId, true, undefined, blendDuration)
      return
    }

    const requestId = ++this.requestId
    this.playbackStatus = 'loading'
    console.log(
      `[ANIMDBG] playManifest id=${id} loop=${loop} blend=${blendDuration} source=${options.requestSource ?? 'unknown'} forceReplay=${forceReplay} (was ${this.activeAnimationId})`,
    )

    try {
      if (!this.avatarModel.isLoaded() || requestId !== this.requestId) return
      this.previousAnimationId = this.activeAnimationId
      this.activeAnimationId = id
      this.activeFileName = entry.file
      this.playbackStatus = 'playing'
      await this.avatarModel.playAnimation(id, loop, {
        animationId: id,
        file: entry.file,
        behaviorId: options.behaviorId ?? 'unknown',
        source: options.requestSource ?? 'unknown',
        reason: options.requestReason ?? 'unspecified',
        previousAnimationId: options.previousAnimationId ?? this.previousAnimationId,
        forceReplay,
        frame: options.frame,
        motionLayer: options.motionLayer ?? 'base',
      })
    } catch (e) {
      if (requestId !== this.requestId) return
      console.warn(`Failed to preview animation "${id}"`, e)
      this.failedIds.add(id)
      this.activeAnimationId = null
      this.activeFileName = null
      this.playbackStatus = 'failed'
      if (fallbackId && fallbackId !== id)
        await this.playManifest(fallbackId, true, undefined, blendDuration)
    }
  }

  getDebugState(): AnimationControllerDebugState {
    if (this.playbackStatus === 'playing' && !this.avatarModel.isAnimationPlaying()) {
      this.playbackStatus = 'idle'
    }

    return {
      activeAnimationId: this.activeAnimationId,
      requestedAnimationId: this.requestedAnimationId,
      previousAnimationId: this.previousAnimationId,
      activeFileName: this.activeFileName,
      requestedFileName: this.requestedFileName,
      loop: this.loop,
      playbackStatus: this.playbackStatus,
      lastBlendDuration: this.lastBlendDuration,
      isPlaybackActive: this.avatarModel.isAnimationPlaying(),
      bodyActions: this.avatarModel.getBodyActionDebugState(),
      failedAnimationIds: [...this.failedIds],
    }
  }
}
