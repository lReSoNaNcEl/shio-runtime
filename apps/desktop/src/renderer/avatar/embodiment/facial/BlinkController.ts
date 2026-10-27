import type { EffectiveBlinkProfile } from './BlinkProfileResolver'

/**
 * BlinkController — Auto Blink source.
 *
 * Owns only blink *timing* and produces a single 0..1 blink weight. It does not
 * write into the VRM Expression Manager; the AvatarExpressionMixer reads
 * {@link getWeight} each frame and owns the blink expression domain.
 *
 * The controller no longer composes profiles itself and no longer accepts the
 * loose per-call `setProfile()` overrides that made behaviour order-dependent.
 * It consumes a single, already-resolved {@link EffectiveBlinkProfile} (see
 * {@link resolveEffectiveBlinkProfile}) and all randomness flows through an
 * injectable {@link RandomSource} so repros/tests are deterministic.
 */

/** Legacy options bag kept only for the emotion base profile in FacialProfile. */
export interface BlinkControllerOptions {
  profileId?: string
  intervalMin?: number
  intervalMax?: number
  duration?: number
  durationMs?: number
  doubleBlinkChance?: number
  weightMin?: number
  weightMax?: number
  blinkMax?: number
  cooldownMs?: number
}

export type RandomSource = () => number

type BlinkPhase = 'idle' | 'closing' | 'closed' | 'opening'
export type BlinkSequenceState = 'none' | 'waiting-second-blink' | 'second-blink'
export type BlinkTriggerReason = 'scheduled' | 'forced' | 'sequence'

export interface BlinkDebugState {
  weight: number
  rawWeight: number
  finalWeight: number
  phase: BlinkPhase
  triggerReason: BlinkTriggerReason
  proceduralMode: string
  emotion: string
  profileId: string
  /** Profile the runtime has configured (drives the NEXT independent event). */
  configuredProfile: EffectiveBlinkProfile
  /**
   * Snapshot the in-flight blink/sequence is completing on, or `null` when idle.
   * Differs from {@link configuredProfile} when emotion/mode changed mid-blink,
   * so the HUD honestly shows both the current and the pending profile.
   */
  activeProfileSnapshot: EffectiveBlinkProfile | null
  sequenceState: BlinkSequenceState
  blinkCount: number
  doubleBlinkCount: number
  // Legacy numeric fields (seconds) preserved for the existing Debug HUD.
  duration: number
  targetWeight: number
  intervalMin: number
  intervalMax: number
  weightMin: number
  weightMax: number
  blinkMax: number
  nextBlinkIn: number
  cooldownRemaining: number
  cooldown: number
  source: 'AutoBlink'
}

const DEFAULT_PROFILE: EffectiveBlinkProfile = {
  profileId: 'idle',
  intervalMinMs: 3400,
  intervalMaxMs: 5200,
  closingMs: 82,
  closedMs: 115,
  openingMs: 213,
  minWeight: 0.42,
  maxWeight: 0.64,
  blinkMax: 0.66,
  doubleBlinkChance: 0.04,
  cooldownMs: 680,
  sequenceGapMinMs: 90,
  sequenceGapMaxMs: 170,
  secondBlinkDurationScale: 0.82,
  secondBlinkWeightScale: 0.88,
}

export class BlinkController {
  private rng: RandomSource
  private active = true

  /** The profile currently configured by the runtime (may change any time). */
  private configuredProfile: EffectiveBlinkProfile = DEFAULT_PROFILE
  /**
   * Snapshot frozen at the start of a blink (or double-blink sequence). The
   * active blink always completes on this snapshot, so a mid-phase profile
   * switch never causes a weight/duration jump; the new profile only takes
   * effect on the next independent event.
   */
  private activeSnapshot: EffectiveBlinkProfile = DEFAULT_PROFILE

  private proceduralModeLabel = 'idle'
  private emotionLabel = 'neutral'

  // Scheduling (all in ms).
  private timerMs = 0
  private nextBlinkInMs = 1200
  private cooldownRemainingMs = 0
  private sequenceGapRemainingMs = 0

  // Active blink phase state.
  private phase: BlinkPhase = 'idle'
  private phaseTimeMs = 0
  private sequenceState: BlinkSequenceState = 'none'
  private triggerReason: BlinkTriggerReason = 'scheduled'
  private pendingSecondBlink = false

  // Per-blink phase durations (from the snapshot, scaled for a second blink).
  private closingMs = DEFAULT_PROFILE.closingMs
  private closedMs = DEFAULT_PROFILE.closedMs
  private openingMs = DEFAULT_PROFILE.openingMs
  private blinkTargetWeight = 0
  private weightCeiling = DEFAULT_PROFILE.blinkMax

  private rawWeight = 0
  private weight = 0

  private blinkCount = 0
  private doubleBlinkCount = 0
  private asymmetry = 0
  private eventAsymmetry = 0
  private winkSide: 'left' | 'right' | null = null
  private winkCooldownMs = 0

  constructor(profile: EffectiveBlinkProfile = DEFAULT_PROFILE, rng: RandomSource = Math.random) {
    this.rng = rng
    this.configuredProfile = profile
    this.activeSnapshot = profile
    this.weightCeiling = profile.blinkMax
  }

  /** Begin blink scheduling for a freshly loaded model. */
  attach(): void {
    this.winkSide = null
    this.winkCooldownMs = 0
    this.phase = 'idle'
    this.sequenceState = 'none'
    this.pendingSecondBlink = false
    this.cooldownRemainingMs = 0
    this.sequenceGapRemainingMs = 0
    this.setWeight(0)
    this.resetSchedule(800)
  }

  detach(): void {
    this.winkSide = null
    this.winkCooldownMs = 0
    this.setWeight(0)
    this.phase = 'idle'
    this.sequenceState = 'none'
    this.pendingSecondBlink = false
    this.cooldownRemainingMs = 0
    this.sequenceGapRemainingMs = 0
  }

  /** Current blink weight (0..1) for the Expression Mixer to apply. */
  getWeight(): number {
    return this.weight
  }

  setAsymmetry(amount: number): void {
    this.asymmetry = Math.max(0, Math.min(0.2, Number.isFinite(amount) ? amount : 0))
  }

  getBilateralWeights(): [number, number] {
    if (this.winkSide) return this.winkSide === 'left' ? [this.weight, 0] : [0, this.weight]
    return [
      this.weight * (1 - Math.max(0, this.eventAsymmetry)),
      this.weight * (1 - Math.max(0, -this.eventAsymmetry)),
    ]
  }

  /**
   * Apply a freshly resolved effective profile. Takes effect immediately for
   * scheduling while idle; if a blink / sequence is in flight the new profile is
   * only used for the next independent event (the active blink keeps its snapshot).
   */
  setEffectiveProfile(
    profile: EffectiveBlinkProfile,
    context?: { proceduralMode?: string; emotion?: string },
  ): void {
    if (context?.proceduralMode !== undefined) this.proceduralModeLabel = context.proceduralMode
    if (context?.emotion !== undefined) this.emotionLabel = context.emotion
    const changed = profile.profileId !== this.configuredProfile.profileId
    this.configuredProfile = profile
    if (this.phase === 'idle' && this.sequenceState === 'none') {
      // No blink in flight: safe to adopt immediately and re-clamp the schedule
      // into the new interval so the change is felt without a jump.
      this.activeSnapshot = profile
      this.weightCeiling = profile.blinkMax
      this.clampScheduleToProfile()
      if (changed) {
        console.log(
          `[FACETRACE] source=Blink event=PROFILE profile=${profile.profileId} mode=${this.proceduralModeLabel} emotion=${this.emotionLabel} t=${Math.round(performance.now())}ms`,
        )
      }
    }
  }

  update(delta: number): void {
    if (!this.active) {
      this.setWeight(0)
      return
    }
    const deltaMs = Math.max(0, delta) * 1000
    this.winkCooldownMs = Math.max(0, this.winkCooldownMs - deltaMs)
    this.cooldownRemainingMs = Math.max(0, this.cooldownRemainingMs - deltaMs)

    if (this.phase !== 'idle') {
      this.updateBlinkPhase(deltaMs)
      return
    }

    if (this.sequenceState === 'waiting-second-blink') {
      // Internal double-blink gap — deliberately NOT gated by the cooldown.
      this.sequenceGapRemainingMs -= deltaMs
      if (this.sequenceGapRemainingMs <= 0) this.launchSecondBlink()
      return
    }

    this.timerMs += deltaMs
    if (this.timerMs >= this.nextBlinkInMs && this.cooldownRemainingMs <= 0) {
      this.launchPrimaryBlink('scheduled')
    }
  }

  /**
   * Force a blink now. Forced blinks are single by default (they never open a
   * double-blink sequence) unless {@link sequence} is explicitly requested.
   */
  force(duration = 1.2, sequence = false): void {
    this.winkSide = null
    this.activeSnapshot = this.configuredProfile
    this.weightCeiling = this.activeSnapshot.blinkMax
    const total =
      this.activeSnapshot.closingMs + this.activeSnapshot.closedMs + this.activeSnapshot.openingMs
    const requestedMs = Math.max(120, duration * 1000)
    const durationScale = Math.max(0.3, Math.min(2, requestedMs / Math.max(1, total)))
    this.beginBlinkPhases(durationScale, 1, 'forced')
    this.pendingSecondBlink = sequence && this.rng() < this.activeSnapshot.doubleBlinkChance
    this.sequenceState = 'none'
  }

  /** One expressive eyelid event; never interrupts a physiological blink. */
  requestWink(side: 'left' | 'right'): boolean {
    if (
      !this.active ||
      this.phase !== 'idle' ||
      this.sequenceState !== 'none' ||
      this.cooldownRemainingMs > 0 ||
      this.winkCooldownMs > 0
    )
      return false
    this.activeSnapshot = this.configuredProfile
    this.weightCeiling = 1
    this.beginBlinkPhases(1.2, 1, 'forced')
    this.blinkTargetWeight = 0.95
    this.winkSide = side
    this.winkCooldownMs = 6000
    this.pendingSecondBlink = false
    this.resetSchedule()
    return true
  }

  setActive(active: boolean): void {
    this.active = active
    if (!active) {
      this.winkSide = null
      this.phase = 'idle'
      this.sequenceState = 'none'
      this.pendingSecondBlink = false
      this.cooldownRemainingMs = 0
      this.sequenceGapRemainingMs = 0
      this.setWeight(0)
    }
  }

  getDebugState(): BlinkDebugState {
    const p = this.activeSnapshot
    const totalMs = p.closingMs + p.closedMs + p.openingMs
    const inFlight = this.phase !== 'idle' || this.sequenceState !== 'none'
    return {
      weight: this.weight,
      rawWeight: this.rawWeight,
      finalWeight: this.weight,
      phase: this.phase,
      triggerReason: this.triggerReason,
      proceduralMode: this.proceduralModeLabel,
      emotion: this.emotionLabel,
      profileId: this.configuredProfile.profileId,
      configuredProfile: this.configuredProfile,
      activeProfileSnapshot: inFlight ? this.activeSnapshot : null,
      sequenceState: this.sequenceState,
      blinkCount: this.blinkCount,
      doubleBlinkCount: this.doubleBlinkCount,
      duration: totalMs / 1000,
      targetWeight: this.blinkTargetWeight,
      intervalMin: this.configuredProfile.intervalMinMs / 1000,
      intervalMax: this.configuredProfile.intervalMaxMs / 1000,
      weightMin: this.configuredProfile.minWeight,
      weightMax: this.configuredProfile.maxWeight,
      blinkMax: this.configuredProfile.blinkMax,
      nextBlinkIn: Math.max(0, this.nextBlinkInMs - this.timerMs) / 1000,
      cooldownRemaining: this.cooldownRemainingMs / 1000,
      cooldown: this.configuredProfile.cooldownMs / 1000,
      source: 'AutoBlink',
    }
  }

  private launchPrimaryBlink(reason: BlinkTriggerReason): void {
    this.activeSnapshot = this.configuredProfile
    this.weightCeiling = this.activeSnapshot.blinkMax
    this.beginBlinkPhases(1, 1, reason)
    this.pendingSecondBlink = this.rng() < this.activeSnapshot.doubleBlinkChance
    this.resetSchedule()
  }

  private launchSecondBlink(): void {
    // Reuse the sequence snapshot; the second blink is shorter and weaker.
    this.sequenceState = 'second-blink'
    this.beginBlinkPhases(
      this.activeSnapshot.secondBlinkDurationScale,
      this.activeSnapshot.secondBlinkWeightScale,
      'sequence',
    )
    this.doubleBlinkCount += 1
  }

  private beginBlinkPhases(
    durationScale: number,
    weightScale: number,
    reason: BlinkTriggerReason,
  ): void {
    this.winkSide = null
    const p = this.activeSnapshot
    this.eventAsymmetry = this.asymmetry ? (this.rng() * 2 - 1) * this.asymmetry : 0
    this.closingMs = p.closingMs * durationScale
    this.closedMs = p.closedMs * durationScale
    this.openingMs = p.openingMs * durationScale
    const depth = p.minWeight + this.rng() * Math.max(0, p.maxWeight - p.minWeight)
    this.blinkTargetWeight = Math.min(this.weightCeiling, depth * weightScale)
    this.phase = 'closing'
    this.phaseTimeMs = 0
    this.triggerReason = reason
    this.blinkCount += 1
    this.setWeight(0)
  }

  private updateBlinkPhase(deltaMs: number): void {
    this.phaseTimeMs += deltaMs

    if (this.phase === 'closing') {
      this.setWeight(
        this.blinkTargetWeight * this.easeOut(Math.min(1, this.phaseTimeMs / this.closingMs)),
      )
      if (this.phaseTimeMs >= this.closingMs) this.nextPhase('closed')
      return
    }

    if (this.phase === 'closed') {
      this.setWeight(this.blinkTargetWeight)
      if (this.phaseTimeMs >= this.closedMs) this.nextPhase('opening')
      return
    }

    if (this.phase === 'opening') {
      this.setWeight(
        this.blinkTargetWeight *
          (1 - this.easeInOut(Math.min(1, this.phaseTimeMs / this.openingMs))),
      )
      if (this.phaseTimeMs >= this.openingMs) {
        this.setWeight(0)
        this.phase = 'idle'
        this.phaseTimeMs = 0
        this.finishBlink()
      }
    }
  }

  private finishBlink(): void {
    if (this.pendingSecondBlink) {
      // Open the internal gap of the double-blink sequence. No cooldown yet — the
      // pair is one event.
      this.pendingSecondBlink = false
      this.sequenceState = 'waiting-second-blink'
      const gapSpan = Math.max(
        0,
        this.activeSnapshot.sequenceGapMaxMs - this.activeSnapshot.sequenceGapMinMs,
      )
      this.sequenceGapRemainingMs = this.activeSnapshot.sequenceGapMinMs + this.rng() * gapSpan
      return
    }
    // End of the (single or double) event — apply the normal cooldown.
    this.winkSide = null
    this.sequenceState = 'none'
    this.cooldownRemainingMs = this.activeSnapshot.cooldownMs
    // Adopt any profile that arrived mid-blink for the next event.
    this.activeSnapshot = this.configuredProfile
    this.weightCeiling = this.activeSnapshot.blinkMax
  }

  private nextPhase(phase: BlinkPhase): void {
    this.phase = phase
    this.phaseTimeMs = 0
  }

  private resetSchedule(minDelayMs = this.configuredProfile.intervalMinMs): void {
    this.timerMs = 0
    const min = minDelayMs
    const span = Math.max(0, this.configuredProfile.intervalMaxMs - min)
    this.nextBlinkInMs = min + this.rng() * span
  }

  /** Re-fit an in-progress idle schedule into a newly configured interval. */
  private clampScheduleToProfile(): void {
    if (this.nextBlinkInMs > this.configuredProfile.intervalMaxMs) {
      this.nextBlinkInMs = this.configuredProfile.intervalMaxMs
    }
  }

  private setWeight(value: number): void {
    this.rawWeight = Math.max(0, value)
    this.weight = Math.max(0, Math.min(this.weightCeiling, value))
  }

  private easeOut(t: number): number {
    return 1 - (1 - t) ** 3
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
  }
}
