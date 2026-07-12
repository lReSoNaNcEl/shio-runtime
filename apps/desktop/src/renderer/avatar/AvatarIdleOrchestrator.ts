import type { AvatarBehaviorResolution } from './AvatarBehaviorResolver'
import type { AvatarStateEffect } from './AvatarStateMachine'

export interface IdleTimelineEvent {
  id: number
  at: number
  animationId: string
}

export interface IdleOrchestratorDebugState {
  paused: boolean
  currentIdleState: string
  idleStage: 'normal-idle' | 'extended-idle'
  nextScheduledIdleAnimation: string
  nextTransitionIn: number
  extendedIdleDuration: number
  currentExtendedIdleAnimation: string
  nextExtendedIdleCandidate: string
  timeline: IdleTimelineEvent[]
}

export class AvatarIdleOrchestrator {
  private paused = false
  private nextTransitionIn = 0
  private nextScheduledIdleAnimation = 'pending'
  private currentIdleState = 'none'
  private idleStage: 'normal-idle' | 'extended-idle' = 'normal-idle'
  private extendedIdleDuration = 0
  private extendedIdleThreshold = this.randomExtendedIdleThreshold()
  private currentExtendedIdleAnimation = 'none'
  private nextExtendedIdleCandidate = 'pending'
  private lastExtendedIdleAnimation: string | null = null
  private returnToNormalIdlePending = false
  private timeline: IdleTimelineEvent[] = []
  private eventSeq = 0

  update(delta: number, mode: AvatarStateEffect['mode']): boolean {
    if (mode !== 'idle' || this.paused) return false

    this.extendedIdleDuration += delta
    this.nextTransitionIn = Math.max(0, this.nextTransitionIn - delta)
    return this.nextTransitionIn === 0
  }

  enterIdle(): void {
    if (this.nextTransitionIn > 0) return
    this.nextTransitionIn = this.randomDwell()
  }

  leaveIdle(): void {
    this.nextScheduledIdleAnimation = 'paused-by-runtime-state'
    this.idleStage = 'normal-idle'
    this.extendedIdleDuration = 0
    this.currentExtendedIdleAnimation = 'none'
    this.nextExtendedIdleCandidate = 'pending'
    this.returnToNormalIdlePending = false
  }

  shouldUseExtendedIdle(): boolean {
    return !this.returnToNormalIdlePending && this.extendedIdleDuration >= this.extendedIdleThreshold
  }

  getLastExtendedIdleAnimation(): string | null {
    return this.lastExtendedIdleAnimation
  }

  recordTransition(resolution: AvatarBehaviorResolution, stage: 'normal-idle' | 'extended-idle' = 'normal-idle'): void {
    this.currentIdleState = resolution.animationId
    this.idleStage = stage
    this.nextTransitionIn = stage === 'extended-idle' ? this.randomExtendedIdleDwell() : this.randomDwell()
    this.nextScheduledIdleAnimation = this.pickLikelyNextCandidate(resolution)
    this.nextExtendedIdleCandidate = this.pickLikelyNextCandidate(resolution)

    if (stage === 'extended-idle') {
      this.currentExtendedIdleAnimation = resolution.animationId
      this.lastExtendedIdleAnimation = resolution.animationId
      this.returnToNormalIdlePending = true
    } else if (this.returnToNormalIdlePending) {
      this.currentExtendedIdleAnimation = 'none'
      this.extendedIdleDuration = 0
      this.extendedIdleThreshold = this.randomExtendedIdleThreshold()
      this.returnToNormalIdlePending = false
      this.nextExtendedIdleCandidate = 'pending'
    }

    this.timeline = [
      ...this.timeline,
      {
        id: ++this.eventSeq,
        at: Date.now(),
        animationId: resolution.animationId
      }
    ].slice(-12)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.nextScheduledIdleAnimation = paused ? 'paused' : 'pending'
    if (!paused && this.nextTransitionIn <= 0) this.nextTransitionIn = this.randomDwell()
  }

  isPaused(): boolean {
    return this.paused
  }

  reset(): void {
    this.currentIdleState = 'none'
    this.idleStage = 'normal-idle'
    this.extendedIdleDuration = 0
    this.extendedIdleThreshold = this.randomExtendedIdleThreshold()
    this.currentExtendedIdleAnimation = 'none'
    this.nextExtendedIdleCandidate = 'pending'
    this.lastExtendedIdleAnimation = null
    this.returnToNormalIdlePending = false
    this.nextScheduledIdleAnimation = this.paused ? 'paused' : 'pending'
    this.nextTransitionIn = this.randomDwell()
    this.timeline = []
  }

  getDebugState(): IdleOrchestratorDebugState {
    return {
      paused: this.paused,
      currentIdleState: this.currentIdleState,
      idleStage: this.idleStage,
      nextScheduledIdleAnimation: this.nextScheduledIdleAnimation,
      nextTransitionIn: Number(Math.max(0, this.nextTransitionIn).toFixed(1)),
      extendedIdleDuration: Number(this.extendedIdleDuration.toFixed(1)),
      currentExtendedIdleAnimation: this.currentExtendedIdleAnimation,
      nextExtendedIdleCandidate: this.nextExtendedIdleCandidate,
      timeline: this.timeline
    }
  }

  private pickLikelyNextCandidate(resolution: AvatarBehaviorResolution): string {
    const next = resolution.candidates.find((candidate) => {
      return candidate.animationId !== resolution.animationId && !candidate.excludedByCooldown
    })
    return next?.animationId ?? 'least-recently-played'
  }

  private randomDwell(): number {
    // Dwell before re-resolving the idle pose. Kept calm (Shio is unhurried) but
    // tight enough that the resting pose visibly refreshes and never feels static.
    return 8 + Math.random() * 10
  }

  private randomExtendedIdleDwell(): number {
    return 10 + Math.random() * 8
  }

  private randomExtendedIdleThreshold(): number {
    return 30 + Math.random() * 30
  }
}
