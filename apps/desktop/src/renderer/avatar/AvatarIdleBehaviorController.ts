import type { AvatarMode } from './AvatarStateMachine'
import type { AvatarModel } from './rendering/two/AvatarModel'

type IdleBehaviorKind =
  | 'none'
  | 'glance-left'
  | 'glance-right'
  | 'glance-down'
  | 'soft-blink'
  | 'posture-shift'

interface IdleBehaviorDebugState {
  activeBehavior: IdleBehaviorKind
  nextBehaviorIn: number
}

export class AvatarIdleBehaviorController {
  private activeBehavior: IdleBehaviorKind = 'none'
  private nextBehaviorIn = 2.5
  private activeFor = 0

  constructor(private avatarModel: AvatarModel) {}

  update(delta: number, mode: AvatarMode): void {
    if (mode !== 'idle' || !this.avatarModel.isLoaded()) {
      this.activeBehavior = 'none'
      this.activeFor = 0
      this.nextBehaviorIn = Math.max(this.nextBehaviorIn, 1.2)
      return
    }

    if (this.activeFor > 0) {
      this.activeFor = Math.max(0, this.activeFor - delta)
      if (this.activeFor === 0) this.activeBehavior = 'none'
      return
    }

    this.nextBehaviorIn -= delta
    if (this.nextBehaviorIn > 0) return

    this.playNextBehavior()
    this.nextBehaviorIn = this.randomBetween(3.0, 6.5)
  }

  reset(): void {
    this.activeBehavior = 'none'
    this.activeFor = 0
    this.nextBehaviorIn = this.randomBetween(1.5, 3.5)
  }

  getDebugState(): IdleBehaviorDebugState & { ambientIdleBehavior: true } {
    return {
      activeBehavior: this.activeBehavior,
      nextBehaviorIn: Number(Math.max(0, this.nextBehaviorIn).toFixed(1)),
      ambientIdleBehavior: true,
    }
  }

  private playNextBehavior(): void {
    const roll = Math.random()

    const glanceLeftThreshold = 0.3
    const glanceRightThreshold = 0.6
    const glanceDownThreshold = 0.78
    const postureThreshold = 0.92

    if (roll < glanceLeftThreshold) {
      this.startGlance('glance-left', -1)
      return
    }

    if (roll < glanceRightThreshold) {
      this.startGlance('glance-right', 1)
      return
    }

    if (roll < glanceDownThreshold) {
      this.activeBehavior = 'glance-down'
      this.activeFor = 1.8
      this.avatarModel.nudgeMicroMotion({ headX: 0.035, eyeY: 0.035, duration: 1.8 })
      return
    }

    if (roll < postureThreshold) {
      this.activeBehavior = 'posture-shift'
      this.activeFor = 2.2
      this.avatarModel.nudgeMicroMotion({
        headX: this.randomBetween(-0.015, 0.015),
        headY: this.randomBetween(-0.025, 0.025),
        duration: 2.2,
      })
      return
    }

    this.activeBehavior = 'soft-blink'
    this.activeFor = 1.0
    this.avatarModel.forceBlink(this.randomBetween(0.75, 1.0))
  }

  private startGlance(kind: IdleBehaviorKind, direction: -1 | 1): void {
    this.activeBehavior = kind
    this.activeFor = 1.6
    this.avatarModel.nudgeMicroMotion({
      headY: 0.028 * direction,
      eyeX: 0.04 * direction,
      duration: 1.6,
    })
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min)
  }
}
