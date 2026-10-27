import {
  MOTION_CATALOG_REVISION,
  type MotionPhaseId,
  type MotionPlanIdentity,
  type MotionProfile,
  motionPlanIdentitySchema,
} from '../../shared/motion'

export type MotionOutcome = 'completed' | 'superseded' | 'cancelled' | 'timed-out' | 'failed'

/** One body-domain execution. Only consumed, applied motion advances its phase. */
export class MotionPhaseExecution {
  phase: MotionPhaseId = 'prepare'
  revision = 0
  elapsedMs = 0
  ready = false
  outcome: MotionOutcome | null = null
  private recoveryRequested = false
  private interrupted = false
  private speechReleased = false
  private failureRequested = false
  private deadlineExpired = false
  private domain: 'local' | 'speech' = 'local'
  private playbackId: string | null = null

  constructor(
    readonly id: string,
    readonly profile: MotionProfile,
  ) {}

  get budget() {
    const budget = this.profile.phases.find((phase) => phase.id === this.phase)
    if (!budget) throw new Error('ARDY_INVALID_PHASE_BUDGET')
    return budget
  }
  get progress(): number {
    return this.elapsedMs + 0.001 >= this.budget.minMs
      ? 1
      : Math.max(0, this.elapsedMs / this.budget.minMs)
  }

  setClock(playbackId: string | null): boolean {
    const next = this.phase === 'recover' ? null : playbackId
    if (next === this.playbackId) return false
    this.playbackId = next
    this.domain = next ? 'speech' : 'local'
    this.revision += 1
    return true
  }

  plan(continuityAnchor: string): MotionPlanIdentity {
    return motionPlanIdentitySchema.parse({
      executionId: this.id,
      planRevision: this.revision,
      catalogRevision: MOTION_CATALOG_REVISION,
      phaseId: this.phase,
      handScoreRevision: this.profile.handScore.revision,
      handRigCalibrationRevision: this.profile.handScore.calibrationRevision,
      clockDomain: this.domain,
      playbackId: this.playbackId,
      continuityAnchor,
    })
  }

  forecastPlan(continuityAnchor: string): MotionPlanIdentity | null {
    if (!this.ready || this.outcome || this.recoveryRequested) return null
    const next = this.phase === 'prepare' ? 'stroke' : this.phase === 'stroke' ? 'hold' : null
    if (!next) return null
    return { ...this.plan(continuityAnchor), phaseId: next, planRevision: this.revision + 1 }
  }

  get wantsRecovery(): boolean {
    return this.recoveryRequested
  }
  get hasTimedOut(): boolean {
    return this.deadlineExpired
  }

  requestRecovery(reason: 'superseded' | 'speech-ended' = 'superseded'): void {
    this.recoveryRequested = true
    this.interrupted = true
    this.speechReleased ||= reason === 'speech-ended'
  }

  requestFailureRecovery(): void {
    this.recoveryRequested = true
    this.failureRequested = true
  }

  advance(deltaSeconds: number, targetReached: boolean): boolean {
    if (this.outcome) return false
    if (
      this.recoveryRequested &&
      this.phase !== 'recover' &&
      (this.failureRequested ||
        this.speechReleased ||
        this.profile.interruptionPolicy.interruptiblePhases.includes(this.phase))
    )
      return this.enter('recover')
    if (!this.ready) return false
    // The owner supplies consumed/applied source time, not a render-frame delta.
    // Its bounded queue permits up to 32 frames (1.6 s) per observation.
    this.elapsedMs += Math.max(0, Math.min(1.6, deltaSeconds)) * 1000
    // A preceding sample may sit 1e-5 source frames below an exact boundary.
    if (this.elapsedMs + 0.001 < this.budget.minMs) return false
    if (this.phase === 'recover') {
      if (targetReached)
        this.outcome = this.deadlineExpired
          ? 'timed-out'
          : this.failureRequested
            ? 'failed'
            : this.interrupted
              ? 'superseded'
              : 'completed'
      else if (this.elapsedMs >= this.budget.maxMs) this.outcome = 'timed-out'
      return false
    }
    if (!targetReached) {
      if (this.elapsedMs >= this.budget.maxMs) {
        this.deadlineExpired = true
        return this.enter('recover')
      }
      return false
    }
    if (this.recoveryRequested) return this.enter('recover')
    if (this.phase === 'hold' && this.profile.kind === 'presence') return false
    return this.enter(
      this.phase === 'prepare' ? 'stroke' : this.phase === 'stroke' ? 'hold' : 'recover',
    )
  }

  private enter(phase: MotionPhaseId): boolean {
    this.phase = phase
    this.elapsedMs = 0
    this.ready = false
    this.revision += 1
    if (phase === 'recover') {
      this.domain = 'local'
      this.playbackId = null
    }
    return true
  }
}
