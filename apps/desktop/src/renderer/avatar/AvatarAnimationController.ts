import { VrmModel, type VrmBodyActionDebugState } from '../three/VrmModel'
import { getAnimation, getAnimationUrl, getRootMotionPolicy, type AnimationId } from './animationManifest'

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
  bodyActions: VrmBodyActionDebugState
  assetCache: {
    fetches: number
    hits: number
    misses: number
  }
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
  private cache = new Map<string, ArrayBuffer>()
  private assetCacheStats = {
    fetches: 0,
    hits: 0,
    misses: 0
  }
  private failedIds = new Set<string>()
  private requestId = 0

  constructor(private vrmModel: VrmModel) {}

  async loadExternal(buffer: ArrayBuffer, loop = true): Promise<void> {
    this.requestId += 1
    this.activeAnimationId = 'external'
    this.requestedAnimationId = 'external'
    this.previousAnimationId = null
    this.activeFileName = 'external'
    this.requestedFileName = 'external'
    this.loop = loop
    this.lastBlendDuration = 0.3
    this.playbackStatus = 'playing'
    this.failedIds.clear()
    await this.vrmModel.loadAnimation(buffer, loop)
  }

  stop(): void {
    this.requestId += 1
    this.activeAnimationId = null
    this.requestedAnimationId = null
    this.previousAnimationId = null
    this.activeFileName = null
    this.requestedFileName = null
    this.loop = false
    this.playbackStatus = 'idle'
    this.vrmModel.stopAnimation()
  }

  /**
   * Play a specific manifest animation directly by id (debug/preview path).
   * Bypasses the semantic pools and plays exactly the requested clip.
   */
  async playManifest(id: string, loop: boolean, fallbackId?: AnimationId, blendDuration = 0.3): Promise<void>
  async playManifest(id: string, loop: boolean, options?: PlayManifestOptions): Promise<void>
  async playManifest(
    id: string,
    loop: boolean,
    fallbackOrOptions?: AnimationId | PlayManifestOptions,
    legacyBlendDuration = 0.3
  ): Promise<void> {
    const options: PlayManifestOptions =
      typeof fallbackOrOptions === 'object' && fallbackOrOptions !== null
        ? fallbackOrOptions
        : { fallbackId: fallbackOrOptions, blendDuration: legacyBlendDuration }
    const fallbackId = options.fallbackId
    const blendDuration = options.blendDuration ?? 0.3
    const forceReplay = options.forceReplay ?? false
    const entry = getAnimation(id)
    const url = getAnimationUrl(id)
    this.requestedAnimationId = id
    this.requestedFileName = entry?.file ?? null
    this.loop = loop
    this.lastBlendDuration = blendDuration

    // Re-selecting the currently-active looping clip must NOT restart it. Reloading
    // would reset the action to t=0 and crossfade, producing a visible jerk / hip
    // pop ("falls from the ceiling"). Keep the already-playing loop as-is. This is
    // exactly what happens when the idle orchestrator re-picks the current pose.
    if (!forceReplay && loop && this.activeAnimationId === id && this.vrmModel.isAnimationPlaying()) {
      this.playbackStatus = 'playing'
      console.log(`[PLAYBACKREQ] final guard ignored already-active loop "${id}" source=${options.requestSource ?? 'unknown'}`)
      return
    }

    if (!this.vrmModel.isLoaded() || !entry || !url) {
      if (entry && !url) this.failedIds.add(id)
      this.playbackStatus = entry && !url ? 'failed' : this.playbackStatus
      if (fallbackId && fallbackId !== id) void this.playManifest(fallbackId, true, undefined, blendDuration)
      return
    }

    const requestId = ++this.requestId
    this.playbackStatus = 'loading'
    console.log(`[ANIMDBG] playManifest id=${id} loop=${loop} blend=${blendDuration} source=${options.requestSource ?? 'unknown'} forceReplay=${forceReplay} (was ${this.activeAnimationId})`)

    try {
      const buffer = await this.loadBuffer(url)
      if (!this.vrmModel.isLoaded() || requestId !== this.requestId) return
      this.previousAnimationId = this.activeAnimationId
      this.activeAnimationId = id
      this.activeFileName = entry.file
      this.playbackStatus = 'playing'
      await this.vrmModel.loadAnimation(buffer, loop, blendDuration, {
        animationId: id,
        file: entry.file,
        behaviorId: options.behaviorId ?? 'unknown',
        source: options.requestSource ?? 'unknown',
        reason: options.requestReason ?? 'unspecified',
        previousAnimationId: options.previousAnimationId ?? this.previousAnimationId,
        forceReplay,
        frame: options.frame,
        rootMotionPolicy: getRootMotionPolicy(entry)
      })
    } catch (e) {
      if (requestId !== this.requestId) return
      console.warn(`Failed to preview animation "${id}"`, e)
      this.failedIds.add(id)
      this.activeAnimationId = null
      this.activeFileName = null
      this.playbackStatus = 'failed'
      if (fallbackId && fallbackId !== id) void this.playManifest(fallbackId, true, undefined, blendDuration)
    }
  }

  getDebugState(): AnimationControllerDebugState {
    if (this.playbackStatus === 'playing' && !this.vrmModel.isAnimationPlaying()) {
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
      isPlaybackActive: this.vrmModel.isAnimationPlaying(),
      bodyActions: this.vrmModel.getBodyActionDebugState(),
      assetCache: { ...this.assetCacheStats },
      failedAnimationIds: [...this.failedIds]
    }
  }

  private async loadBuffer(url: string): Promise<ArrayBuffer> {
    const cached = this.cache.get(url)
    this.assetCacheStats.fetches += 1
    if (cached) {
      this.assetCacheStats.hits += 1
      return cached.slice(0)
    }

    this.assetCacheStats.misses += 1
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const buffer = await res.arrayBuffer()
    this.cache.set(url, buffer)
    return buffer.slice(0)
  }
}
