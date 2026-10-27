import type { BodyTurnIntent } from '../../shared/motion'
import { type AnimationId, getAnimation } from './animationManifest'
import type { AvatarBodyMotionLayer } from './embodiment/motion/AvatarMotionLayer'
import type { GeneratedBodyDebugState, VrmModel } from './rendering/three/VrmModel'

export type AnimationPlaybackStatus = 'idle' | 'loading' | 'playing' | 'failed'

export interface AnimationControllerDebugState {
  /** Semantic key or manifest id currently playing. */
  activeAnimationId: string | null
  /** Semantic key or manifest id most recently requested. */
  requestedAnimationId: string | null
  previousAnimationId: string | null
  loop: boolean
  playbackStatus: AnimationPlaybackStatus
  isPlaybackActive: boolean
  bodyMotion: GeneratedBodyDebugState
  failedAnimationIds: string[]
}

export interface PlayManifestOptions {
  bodyAction?: BodyTurnIntent
  seed?: number
  speechBound?: boolean
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
  private loop = false
  private playbackStatus: AnimationPlaybackStatus = 'idle'
  private failedIds = new Set<string>()
  private requestId = 0
  private latestPlaybackRequest: Promise<void> = Promise.resolve()

  constructor(private vrmModel: VrmModel) {}

  stop(): void {
    this.requestId += 1
    this.activeAnimationId = null
    this.requestedAnimationId = null
    this.previousAnimationId = null
    this.loop = false
    this.playbackStatus = 'idle'
    this.vrmModel.stopAnimation()
  }

  /** Request one semantic generated profile through the existing body owner. */
  playManifest(id: string, loop: boolean, options: PlayManifestOptions = {}): Promise<void> {
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
      return this.playbackStatus === 'playing' && this.vrmModel.isAnimationPlaying()
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
    this.requestedAnimationId = id
    this.loop = loop

    // Preserve an already running presence unless an explicit variation was requested.
    if (
      !forceReplay &&
      loop &&
      this.activeAnimationId === id &&
      this.vrmModel.isAnimationPlaying()
    ) {
      this.playbackStatus = 'playing'
      console.log(
        `[PLAYBACKREQ] final guard ignored already-active loop "${id}" source=${options.requestSource ?? 'unknown'}`,
      )
      return
    }

    if (!this.vrmModel.isLoaded() || !entry) {
      if (fallbackId && fallbackId !== id)
        await this.playManifest(fallbackId, true, {
          ...options,
          fallbackId: undefined,
          motionLayer: 'base',
          requestReason: `${options.requestReason ?? 'unspecified'}; fallback from ${id}`,
        })
      else {
        this.activeAnimationId = null
        this.playbackStatus = 'failed'
      }
      return
    }

    const requestId = ++this.requestId
    this.playbackStatus = 'loading'
    console.log(
      `[ANIMDBG] playManifest id=${id} loop=${loop} blend=${blendDuration} source=${options.requestSource ?? 'unknown'} forceReplay=${forceReplay} (was ${this.activeAnimationId})`,
    )

    try {
      if (!this.vrmModel.isLoaded() || requestId !== this.requestId) return
      this.previousAnimationId = this.activeAnimationId
      this.activeAnimationId = id
      await this.vrmModel.requestGeneratedMotion(id, {
        animationId: id,
        blendDuration,
        speechBound: options.speechBound,
        seed: options.seed,
        bodyAction: options.bodyAction,
        behaviorId: options.behaviorId ?? 'unknown',
        source: options.requestSource ?? 'unknown',
        reason: options.requestReason ?? 'unspecified',
        previousAnimationId: options.previousAnimationId ?? this.previousAnimationId,
        forceReplay,
        frame: options.frame,
        motionLayer: options.motionLayer ?? 'base',
      })
      if (requestId === this.requestId) this.playbackStatus = 'playing'
    } catch (e) {
      if (requestId !== this.requestId) return
      if (
        e instanceof Error &&
        ['ARDY_SPEECH_WINDOW_MISSED', 'ARDY_SPEECH_ENDED', 'ARDY_superseded'].includes(e.message)
      ) {
        // Timing expiry is an ordinary skipped intent, not a defective profile.
        // The queue owner resumes presence after the body's recovery settles.
        console.debug(`[ANIMDBG] skipped id=${id} reason=${e.message}`)
        this.activeAnimationId = null
        this.playbackStatus = 'idle'
        return
      }
      console.warn(`Failed to preview animation "${id}"`, e)
      this.failedIds.add(id)
      this.activeAnimationId = null
      this.playbackStatus = 'failed'
      if (fallbackId && fallbackId !== id)
        await this.playManifest(fallbackId, true, {
          ...options,
          fallbackId: undefined,
          motionLayer: 'base',
          requestReason: `${options.requestReason ?? 'unspecified'}; fallback from ${id}`,
        })
    }
  }

  getDebugState(): AnimationControllerDebugState {
    return {
      activeAnimationId: this.activeAnimationId,
      requestedAnimationId: this.requestedAnimationId,
      previousAnimationId: this.previousAnimationId,
      loop: this.loop,
      playbackStatus:
        this.playbackStatus === 'playing' && !this.vrmModel.isAnimationPlaying()
          ? 'idle'
          : this.playbackStatus,
      isPlaybackActive: this.vrmModel.isAnimationPlaying(),
      bodyMotion: this.vrmModel.getBodyMotionDebugState(),
      failedAnimationIds: [...this.failedIds],
    }
  }
}
