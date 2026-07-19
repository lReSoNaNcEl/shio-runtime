import type { AvatarMode } from './AvatarStateMachine'
import type { VrmModel } from './rendering/three/VrmModel'

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
  private passiveCompanionMode = false

  constructor(private vrmModel: VrmModel) {}

  update(delta: number, mode: AvatarMode): void {
    if (mode !== 'idle' || !this.vrmModel.isLoaded()) {
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
    this.nextBehaviorIn = this.passiveCompanionMode
      ? this.randomBetween(3.0, 6.5)
      : this.randomBetween(7.0, 14.0)
  }

  setPassiveCompanionMode(enabled: boolean): void {
    if (this.passiveCompanionMode === enabled) return
    this.passiveCompanionMode = enabled
    this.reset()
  }

  reset(): void {
    this.activeBehavior = 'none'
    this.activeFor = 0
    this.nextBehaviorIn = this.passiveCompanionMode
      ? this.randomBetween(1.5, 3.5)
      : this.randomBetween(4.0, 8.0)
  }

  getDebugState(): IdleBehaviorDebugState & { passiveCompanionMode: boolean } {
    return {
      activeBehavior: this.activeBehavior,
      nextBehaviorIn: Number(Math.max(0, this.nextBehaviorIn).toFixed(1)),
      passiveCompanionMode: this.passiveCompanionMode,
    }
  }

  private playNextBehavior(): void {
    const roll = Math.random()

    const glanceLeftThreshold = this.passiveCompanionMode ? 0.3 : 0.22
    const glanceRightThreshold = this.passiveCompanionMode ? 0.6 : 0.44
    const glanceDownThreshold = this.passiveCompanionMode ? 0.78 : 0.64
    const postureThreshold = this.passiveCompanionMode ? 0.92 : 0.82

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
      this.vrmModel.nudgeMicroMotion({ headX: 0.035, eyeY: 0.035, duration: 1.8 })
      return
    }

    if (roll < postureThreshold) {
      this.activeBehavior = 'posture-shift'
      this.activeFor = 2.2
      this.vrmModel.nudgeMicroMotion({
        headX: this.randomBetween(-0.015, 0.015),
        headY: this.randomBetween(-0.025, 0.025),
        duration: 2.2,
      })
      return
    }

    this.activeBehavior = 'soft-blink'
    this.activeFor = 1.0
    this.vrmModel.forceBlink(this.randomBetween(0.75, 1.0))
  }

  private startGlance(kind: IdleBehaviorKind, direction: -1 | 1): void {
    this.activeBehavior = kind
    this.activeFor = 1.6
    this.vrmModel.nudgeMicroMotion({
      headY: 0.028 * direction,
      eyeX: 0.04 * direction,
      duration: 1.6,
    })
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min)
  }
}
