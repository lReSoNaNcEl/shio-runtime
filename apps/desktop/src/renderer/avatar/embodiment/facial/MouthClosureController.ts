import { facialTuning } from '../../tuning/facialTuning'

/**
 * MouthClosureController — Mouth Closure Envelope source.
 *
 * The tuned LipSync signal keeps the mouth slightly open almost continuously
 * during speech. This controller adds brief, constrained procedural lip
 * closures on top of that signal so the lips actually meet between syllables,
 * on micro-pauses, and at chunk / sentence boundaries.
 *
 * It owns only a single 0..1 closure strength (0 = no closure, 1 = fully shut).
 * It never touches the LipSync signal and never writes into the facial
 * Manager — the AvatarExpressionMixer reads {@link getStrength} and applies it
 * as a multiplier on the final mouth value:
 *
 *   finalMouth = lipSyncValue * (1 - closureStrength)
 */
export interface MouthClosureDebug {
  enabled: boolean
  active: boolean
  strength: number
  sinceLastClosureMs: number
  nextClosureInMs: number
  boundary: boolean
  graceRemainingMs: number
  mouthClosureFactor: number
  suppressedFrames: number
  recoveryCooldownMs: number
}

export class MouthClosureController {
  private strength = 0
  private closureActive = false
  private closureElapsedMs = 0
  private closureDurationMs = 0
  private sinceLastClosureMs = 0
  private currentMinIntervalMs = 0
  private boundary = false
  private wasSpeaking = false
  private graceRemainingMs = 0
  private recoveryCooldownMs = 0
  private suppressedFrames = 0
  private wasAntiStallActive = false

  attach(): void {
    this.reset()
  }

  detach(): void {
    this.reset()
  }

  private reset(): void {
    this.strength = 0
    this.closureActive = false
    this.closureElapsedMs = 0
    this.closureDurationMs = 0
    this.sinceLastClosureMs = 0
    this.currentMinIntervalMs = this.randomInterval()
    this.boundary = false
    this.wasSpeaking = false
    this.graceRemainingMs = 0
    this.recoveryCooldownMs = 0
    this.suppressedFrames = 0
    this.wasAntiStallActive = false
  }

  update(
    delta: number,
    speaking: boolean,
    speechEnergy: number,
    mouthOpenness: number,
    antiStallActive: boolean,
  ): void {
    const tuning = facialTuning.mouthClosure
    const dtMs = Math.max(0, delta) * 1000
    const smooth = 1 - Math.exp(-Math.max(0, delta) * Math.max(0.1, tuning.interpolationSpeed))

    // Speaking onset (false → true): a fresh speech segment must never be
    // suppressed. Cancel any leftover closure, reset scheduling so idle-accrued
    // time cannot trigger an immediate closure, and open a startup grace window.
    if (speaking && !this.wasSpeaking) {
      this.closureActive = false
      this.closureElapsedMs = 0
      this.boundary = false
      this.strength = 0
      this.sinceLastClosureMs = 0
      this.currentMinIntervalMs = this.randomInterval()
      this.graceRemainingMs = tuning.startupGraceMs
    }

    if (!tuning.enabled) {
      this.strength = this.strength + (0 - this.strength) * smooth
      this.wasSpeaking = speaking
      return
    }

    if (this.graceRemainingMs > 0) this.graceRemainingMs = Math.max(0, this.graceRemainingMs - dtMs)
    if (this.recoveryCooldownMs > 0)
      this.recoveryCooldownMs = Math.max(0, this.recoveryCooldownMs - dtMs)
    if (this.wasAntiStallActive && !antiStallActive)
      this.recoveryCooldownMs = tuning.recoveryCooldownMs
    this.wasAntiStallActive = antiStallActive
    const inGrace = this.graceRemainingMs > 0

    const voicing = speaking && speechEnergy >= tuning.minEnergyToSpeak

    // Boundary closure only on speaking end (true → false), never on the onset
    // and never during a (very short) segment's startup grace.
    if (this.wasSpeaking && !speaking && !this.closureActive && !inGrace) {
      this.startClosure(tuning.sentenceBoundaryClosureMs, true)
    }
    this.wasSpeaking = speaking

    this.sinceLastClosureMs += dtMs

    if (this.closureActive) {
      this.closureElapsedMs += dtMs
      if (this.closureElapsedMs >= this.closureDurationMs) {
        this.closureActive = false
        this.boundary = false
        this.sinceLastClosureMs = 0
        this.currentMinIntervalMs = this.randomInterval()
      }
    } else if (
      !inGrace &&
      !antiStallActive &&
      this.recoveryCooldownMs <= 0 &&
      mouthOpenness >= tuning.minVisibleOpenness &&
      voicing &&
      this.sinceLastClosureMs >= this.currentMinIntervalMs
    ) {
      // Opportunity window elapsed: roll for a closure, then re-space regardless
      // so closures stay well separated even when the roll fails.
      if (Math.random() < tuning.probability) {
        this.startClosure(this.randomDuration(), false)
      } else {
        this.sinceLastClosureMs = 0
        this.currentMinIntervalMs = this.randomInterval()
      }
    }

    // Envelope: sine ramp in/out over the closure duration, smoothed toward zero
    // when inactive so the lips never snap.
    const target = this.closureActive
      ? Math.sin(
          Math.PI * Math.min(1, this.closureElapsedMs / Math.max(1, this.closureDurationMs)),
        ) * tuning.closureStrength
      : 0
    this.strength = this.strength + (target - this.strength) * smooth
    if (this.strength < 0.001) this.strength = 0
    if (this.strength > 0 && mouthOpenness * (1 - this.strength) < tuning.minVisibleOpenness)
      this.suppressedFrames += 1
  }

  getStrength(): number {
    return this.strength
  }

  getDebugState(): MouthClosureDebug {
    return {
      enabled: facialTuning.mouthClosure.enabled,
      active: this.closureActive,
      strength: this.strength,
      sinceLastClosureMs: this.sinceLastClosureMs,
      nextClosureInMs: this.closureActive
        ? 0
        : Math.max(0, this.currentMinIntervalMs - this.sinceLastClosureMs),
      boundary: this.boundary,
      graceRemainingMs: this.graceRemainingMs,
      mouthClosureFactor: 1 - this.strength,
      suppressedFrames: this.suppressedFrames,
      recoveryCooldownMs: this.recoveryCooldownMs,
    }
  }

  private startClosure(durationMs: number, boundary: boolean): void {
    this.closureActive = true
    this.closureElapsedMs = 0
    this.closureDurationMs = Math.max(1, durationMs)
    this.boundary = boundary
  }

  private randomDuration(): number {
    const { min, max } = facialTuning.mouthClosure.closureDurationMs
    return min + Math.random() * Math.max(0, max - min)
  }

  private randomInterval(): number {
    const { min, max } = facialTuning.mouthClosure.minIntervalMs
    return min + Math.random() * Math.max(0, max - min)
  }
}
