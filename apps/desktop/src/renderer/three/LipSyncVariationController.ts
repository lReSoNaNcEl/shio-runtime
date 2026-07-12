import { facialTuning } from './avatarTuning'
import type { MouthWeights } from './FacialProfile'

export interface LipSyncVariationProfile {
  opennessGain: number
  widthBias: number
  roundnessBias: number
}

const NEUTRAL_PROFILE: LipSyncVariationProfile = {
  opennessGain: 1,
  widthBias: 0,
  roundnessBias: 0,
}

let nextInstanceSeed = 0x6d2b79f5

/**
 * Per-avatar procedural state for subtle articulation variation.
 * Selects one profile at speech playback start and periodically refreshes it
 * during long continuous playback.
 *
 * It never creates visemes and only modifies mouth weights already produced by
 * LipSync.
 */
export class LipSyncVariationController {
  private current: LipSyncVariationProfile = { ...NEUTRAL_PROFILE }
  private transitionFrom: LipSyncVariationProfile = { ...NEUTRAL_PROFILE }
  private target: LipSyncVariationProfile = { ...NEUTRAL_PROFILE }
  private emotion = 'neutral'
  private speaking = false
  private speechElapsedMs = 0
  private transitionElapsedMs = 0
  private transitionDurationMs = 0
  private nextRefreshMs = Number.POSITIVE_INFINITY
  private randomState: number

  constructor() {
    this.randomState = nextInstanceSeed >>> 0
    nextInstanceSeed = (nextInstanceSeed + 0x9e3779b9) >>> 0
  }

  reset(): void {
    this.current = { ...NEUTRAL_PROFILE }
    this.transitionFrom = { ...NEUTRAL_PROFILE }
    this.target = { ...NEUTRAL_PROFILE }
    this.speaking = false
    this.speechElapsedMs = 0
    this.transitionElapsedMs = 0
    this.transitionDurationMs = 0
    this.nextRefreshMs = Number.POSITIVE_INFINITY
  }

  setEmotion(emotion: string): void {
    const nextEmotion = emotion || 'neutral'
    if (nextEmotion === this.emotion) return
    this.emotion = nextEmotion
    // Character State may change emotion on the same edge that starts speech.
    // Retarget from the current interpolated profile instead of keeping a
    // profile selected for the previous emotion.
    if (this.speaking) this.beginTransition(this.createProfile())
  }

  startSpeechSegment(): void {
    this.reset()
    this.speaking = true
    this.beginTransition(this.createProfile())
    this.scheduleRefresh()
  }

  endSpeech(): void {
    this.reset()
  }

  update(delta: number): void {
    if (!this.speaking || !facialTuning.lipSync.microVariation.enabled) return

    const deltaMs = Math.max(0, delta) * 1000
    this.speechElapsedMs += deltaMs
    this.transitionElapsedMs += deltaMs
    const progress =
      this.transitionDurationMs > 0
        ? Math.min(1, this.transitionElapsedMs / this.transitionDurationMs)
        : 1
    const eased = progress * progress * (3 - 2 * progress)
    this.current = this.lerpProfile(this.transitionFrom, this.target, eased)

    if (
      this.speechElapsedMs >= facialTuning.lipSync.microVariation.shortSpeechThresholdMs &&
      this.speechElapsedMs >= this.nextRefreshMs
    ) {
      this.beginTransition(this.createProfile())
      this.scheduleRefresh()
    }
  }

  apply(weights: MouthWeights): MouthWeights {
    if (!this.speaking || !facialTuning.lipSync.microVariation.enabled) return { ...weights }

    const openness = this.current.opennessGain
    const width = Math.max(0, 1 + this.current.widthBias)
    const roundness = Math.max(0, 1 + this.current.roundnessBias)
    return {
      aa: weights.aa * openness,
      ih: weights.ih * openness * width,
      ou: weights.ou * openness * roundness,
      ee: weights.ee * openness * width,
      oh: weights.oh * openness * roundness,
    }
  }

  private beginTransition(target: LipSyncVariationProfile): void {
    const cfg = facialTuning.lipSync.microVariation
    this.transitionFrom = { ...this.current }
    this.target = target
    this.transitionElapsedMs = 0
    this.transitionDurationMs = this.randomRange(cfg.transitionMs.min, cfg.transitionMs.max)
  }

  private scheduleRefresh(): void {
    const refresh = facialTuning.lipSync.microVariation.longChunkRefreshMs
    this.nextRefreshMs = this.speechElapsedMs + this.randomRange(refresh.min, refresh.max)
  }

  private createProfile(): LipSyncVariationProfile {
    const cfg = facialTuning.lipSync.microVariation
    const emotionScale =
      cfg.emotionScale[this.emotion as keyof typeof cfg.emotionScale] ?? cfg.emotionScale.neutral
    const emotionBias =
      cfg.emotionBias[this.emotion as keyof typeof cfg.emotionBias] ?? cfg.emotionBias.neutral
    return {
      opennessGain:
        1 + (this.randomRange(cfg.opennessGain.min, cfg.opennessGain.max) - 1) * emotionScale,
      widthBias: this.clamp(
        this.randomRange(cfg.widthBias.min, cfg.widthBias.max) * emotionScale + emotionBias.width,
        cfg.widthBias.min,
        cfg.widthBias.max,
      ),
      roundnessBias: this.clamp(
        this.randomRange(cfg.roundnessBias.min, cfg.roundnessBias.max) * emotionScale +
          emotionBias.roundness,
        cfg.roundnessBias.min,
        cfg.roundnessBias.max,
      ),
    }
  }

  private lerpProfile(
    a: LipSyncVariationProfile,
    b: LipSyncVariationProfile,
    t: number,
  ): LipSyncVariationProfile {
    return {
      opennessGain: this.lerp(a.opennessGain, b.opennessGain, t),
      widthBias: this.lerp(a.widthBias, b.widthBias, t),
      roundnessBias: this.lerp(a.roundnessBias, b.roundnessBias, t),
    }
  }

  private randomRange(min: number, max: number): number {
    return min + (max - min) * this.nextRandom()
  }

  private nextRandom(): number {
    let value = this.randomState || 0x6d2b79f5
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.randomState = value >>> 0
    return this.randomState / 0x100000000
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }
}
