import { facialTuning } from '../../tuning/facialTuning'

/**
 * SpeakingEyeController — Speaking Eye Micro-Expression source.
 *
 * Produces a small, slowly drifting partial eye-narrow (per eye) while the
 * character is speaking. It exists to break the static "always the same squint"
 * look: after every blink the eyes ease back toward the *current* drifting
 * target rather than one fixed openness.
 *
 * It owns only a 0..maxSquint weight per eye and never writes into the previous rig
 * Expression Manager — the AvatarExpressionMixer reads {@link getLeft} /
 * {@link getRight} each frame and combines them with the Blink domain (Blink
 * always wins full closure). Emotion modifies the drift; it never replaces it.
 */
export interface SpeakingEyeDebug {
  enabled: boolean
  speaking: boolean
  targetLeft: number
  targetRight: number
  currentLeft: number
  currentRight: number
  leftOffset: number
  rightOffset: number
  nextVariationMs: number
  emotion: string
}

export class SpeakingEyeController {
  private currentLeft = 0
  private currentRight = 0
  private targetLeft = 0
  private targetRight = 0
  private timerMs = 0
  private nextVariationMs = 0
  private speaking = false
  private emotionKey = 'neutral'

  /** Reset all drift state for a freshly loaded model. */
  attach(): void {
    this.reset()
  }

  detach(): void {
    this.reset()
  }

  private reset(): void {
    this.currentLeft = 0
    this.currentRight = 0
    this.targetLeft = 0
    this.targetRight = 0
    this.timerMs = 0
    this.nextVariationMs = 0
    this.speaking = false
  }

  update(delta: number, speaking: boolean, emotionKey: string): void {
    const tuning = facialTuning.speakingEye
    this.emotionKey = emotionKey
    const wasSpeaking = this.speaking
    this.speaking = speaking && tuning.enabled

    const speed = Math.max(0.1, tuning.interpolationSpeed)
    const smooth = 1 - Math.exp(-Math.max(0, delta) * speed)

    if (!this.speaking) {
      // Ease the squint away; re-seed on the next speaking onset so speech does
      // not always begin from the same value.
      this.targetLeft = 0
      this.targetRight = 0
      this.currentLeft = this.approach(this.currentLeft, 0, smooth)
      this.currentRight = this.approach(this.currentRight, 0, smooth)
      this.timerMs = 0
      this.nextVariationMs = 0
      return
    }

    // Fresh onset (or first tick) → pick an initial target immediately.
    if (!wasSpeaking || this.nextVariationMs <= 0) {
      this.pickTargets()
    }

    this.timerMs += Math.max(0, delta) * 1000
    if (this.timerMs >= this.nextVariationMs) {
      this.pickTargets()
    }

    this.currentLeft = this.approach(this.currentLeft, this.targetLeft, smooth)
    this.currentRight = this.approach(this.currentRight, this.targetRight, smooth)
  }

  getLeft(): number {
    return this.currentLeft
  }

  getRight(): number {
    return this.currentRight
  }

  getDebugState(): SpeakingEyeDebug {
    return {
      enabled: facialTuning.speakingEye.enabled,
      speaking: this.speaking,
      targetLeft: this.targetLeft,
      targetRight: this.targetRight,
      currentLeft: this.currentLeft,
      currentRight: this.currentRight,
      leftOffset: this.currentLeft - this.currentRight,
      rightOffset: this.currentRight - this.currentLeft,
      nextVariationMs: Math.max(0, this.nextVariationMs - this.timerMs),
      emotion: this.emotionKey,
    }
  }

  private pickTargets(): void {
    const tuning = facialTuning.speakingEye
    const mod = tuning.emotions[this.emotionKey] ?? tuning.emotions.neutral
    const base = tuning.baseSquint * mod.squintScale
    const variation = tuning.opennessVariation * mod.variationScale

    const center = base + (Math.random() - 0.5) * variation
    const asym = (Math.random() - 0.5) * tuning.asymmetry
    this.targetLeft = this.clampSquint(center + asym * 0.5)
    this.targetRight = this.clampSquint(center - asym * 0.5)

    this.timerMs = 0
    const { min, max } = tuning.targetIntervalMs
    this.nextVariationMs = min + Math.random() * Math.max(0, max - min)
  }

  private clampSquint(value: number): number {
    const tuning = facialTuning.speakingEye
    // Floor with minSquint so a speaking target keeps a light living squint and
    // never resolves to fully neutral-open. The non-speaking path zeroes the
    // targets directly (bypassing this) so idle eyes still fully open.
    return Math.max(tuning.minSquint, Math.min(tuning.maxSquint, value))
  }

  private approach(current: number, target: number, smooth: number): number {
    const next = current + (target - current) * smooth
    return Math.abs(next) < 0.0005 ? 0 : next
  }
}
