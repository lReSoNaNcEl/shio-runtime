import type { VRM } from '@pixiv/three-vrm'

import { speechBodyTuning } from '../../tuning/motionTuning'
import { BoundedRandomMotionChannel, SeededRandom, smoothUnit } from './SeededMotion'

export interface MicroMotionProfile {
  swayWeight?: number
  postureWeight?: number
  shoulderWeight?: number
}

export interface MicroMotionDebugState {
  spinePitch: number
  spineRoll: number
  chestYaw: number
  shoulderLeft: number
  shoulderRight: number
  headPitch: number
  headYaw: number
  upperBodyAuthority: number
  headAuthority: number
  speechPitch: number
}

let microMotionInstanceSequence = 0

export class MicroMotionController {
  private vrm: VRM | null = null
  private swayWeight = 0.55
  private postureWeight = 0.55
  private shoulderWeight = 0.45
  private upperBodyAuthority = 1
  private headAuthority = 1
  private lookAtActive = false
  private speechEnergy = 0
  private speechPitch = 0
  private spinePitch = 0
  private spineRoll = 0
  private chestYaw = 0
  private shoulderLeft = 0
  private shoulderRight = 0
  private headOffsetX = 0
  private headOffsetY = 0
  private leftEyeOffsetX = 0
  private leftEyeOffsetY = 0
  private rightEyeOffsetX = 0
  private rightEyeOffsetY = 0
  private impulseTime = 0
  private impulseDuration = 1
  private impulseHeadX = 0
  private impulseHeadY = 0
  private impulseEyeX = 0
  private impulseEyeY = 0
  private readonly spinePitchChannel: BoundedRandomMotionChannel
  private readonly spineRollChannel: BoundedRandomMotionChannel
  private readonly chestYawChannel: BoundedRandomMotionChannel
  private readonly shoulderLeftChannel: BoundedRandomMotionChannel
  private readonly shoulderRightChannel: BoundedRandomMotionChannel

  constructor(seed = 0x9e3779 + ++microMotionInstanceSequence * 104729) {
    this.spinePitchChannel = new BoundedRandomMotionChannel(new SeededRandom(seed ^ 0x21f0aaad), {
      amplitude: 0.006,
      intervalSeconds: { min: 2.8, max: 6.2 },
      stiffness: 4.5,
      damping: 4.4,
    })
    this.spineRollChannel = new BoundedRandomMotionChannel(new SeededRandom(seed ^ 0x735a2d97), {
      amplitude: 0.007,
      intervalSeconds: { min: 2.2, max: 5.4 },
      stiffness: 5.2,
      damping: 4.8,
    })
    this.chestYawChannel = new BoundedRandomMotionChannel(new SeededRandom(seed ^ 0x4c3b2a19), {
      amplitude: 0.006,
      intervalSeconds: { min: 3.1, max: 7.2 },
      stiffness: 3.8,
      damping: 4.1,
    })
    this.shoulderLeftChannel = new BoundedRandomMotionChannel(new SeededRandom(seed ^ 0x65d200ce), {
      amplitude: 0.005,
      intervalSeconds: { min: 1.8, max: 4.6 },
      stiffness: 6,
      damping: 5.1,
    })
    this.shoulderRightChannel = new BoundedRandomMotionChannel(
      new SeededRandom(seed ^ 0x18b7f311),
      {
        amplitude: 0.005,
        intervalSeconds: { min: 2.1, max: 5.1 },
        stiffness: 5.5,
        damping: 4.9,
      },
    )
  }

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm
  }

  detach(): void {
    this.remove()
    this.vrm = null
    this.spinePitchChannel.reset()
    this.spineRollChannel.reset()
    this.chestYawChannel.reset()
    this.shoulderLeftChannel.reset()
    this.shoulderRightChannel.reset()
    this.resetOffsets()
    this.clearImpulse()
    this.speechEnergy = 0
    this.speechPitch = 0
  }

  setProfile(profile: MicroMotionProfile): void {
    this.swayWeight = profile.swayWeight ?? this.swayWeight
    this.postureWeight = profile.postureWeight ?? this.postureWeight
    this.shoulderWeight = profile.shoulderWeight ?? this.shoulderWeight
  }

  setSpeechEnergy(energy: number): void {
    this.speechEnergy = Number.isFinite(energy) ? clamp01(energy) : 0
  }

  setAuthority(upperBodyWeight: number, headWeight: number): void {
    this.upperBodyAuthority = clamp01(upperBodyWeight)
    this.headAuthority = clamp01(headWeight)
  }

  setLookAtActive(active: boolean): void {
    this.lookAtActive = active
    if (active) this.removeEyeOffsets()
  }

  nudge(options: {
    headX?: number
    headY?: number
    eyeX?: number
    eyeY?: number
    duration?: number
  }): void {
    this.impulseHeadX = clampSigned(options.headX ?? 0, 0.045)
    this.impulseHeadY = clampSigned(options.headY ?? 0, 0.045)
    this.impulseEyeX = clampSigned(options.eyeX ?? 0, 0.04)
    this.impulseEyeY = clampSigned(options.eyeY ?? 0, 0.04)
    this.impulseDuration = Math.max(0.4, options.duration ?? 1.6)
    this.impulseTime = this.impulseDuration
  }

  remove(): void {
    if (!this.vrm?.humanoid) return

    const spine = this.vrm.humanoid.getNormalizedBoneNode('spine')
    if (spine) {
      spine.rotation.x -= this.spinePitch
      spine.rotation.z -= this.spineRoll
    }

    const chest = this.vrm.humanoid.getNormalizedBoneNode('chest')
    if (chest) chest.rotation.y -= this.chestYaw

    const leftShoulder = this.vrm.humanoid.getNormalizedBoneNode('leftShoulder')
    if (leftShoulder) leftShoulder.rotation.z -= this.shoulderLeft
    const rightShoulder = this.vrm.humanoid.getNormalizedBoneNode('rightShoulder')
    if (rightShoulder) rightShoulder.rotation.z -= this.shoulderRight

    const head = this.vrm.humanoid.getNormalizedBoneNode('head')
    if (head) {
      head.rotation.x -= this.headOffsetX
      head.rotation.y -= this.headOffsetY
    }

    this.removeEyeOffsets()
    this.resetAppliedBodyOffsets()
  }

  update(delta: number): void {
    if (!this.vrm?.humanoid) return

    this.updateImpulse(delta)
    this.updateBody(delta)
    this.updateHeadImpulse()
    this.updateEyeImpulse()
  }

  getDebugState(): MicroMotionDebugState {
    return {
      spinePitch: this.spinePitch,
      spineRoll: this.spineRoll,
      chestYaw: this.chestYaw,
      shoulderLeft: this.shoulderLeft,
      shoulderRight: this.shoulderRight,
      headPitch: this.headOffsetX,
      headYaw: this.headOffsetY,
      upperBodyAuthority: this.upperBodyAuthority,
      headAuthority: this.headAuthority,
      speechPitch: this.speechPitch * this.upperBodyAuthority,
    }
  }

  private updateBody(delta: number): void {
    if (!this.vrm?.humanoid) return
    const authority = this.upperBodyAuthority
    const target = -this.speechEnergy * speechBodyTuning.maxPitch
    const smoothing = this.speechEnergy > 0 ? speechBodyTuning.attack : speechBodyTuning.release
    this.speechPitch +=
      (target - this.speechPitch) * (1 - Math.exp(-smoothing * Math.max(0, delta)))
    const nextSpinePitch =
      (this.spinePitchChannel.update(delta) * this.postureWeight + this.speechPitch) * authority
    const nextSpineRoll = this.spineRollChannel.update(delta) * this.swayWeight * authority
    const nextChestYaw = this.chestYawChannel.update(delta) * this.postureWeight * authority
    const nextShoulderLeft =
      this.shoulderLeftChannel.update(delta) * this.shoulderWeight * authority
    const nextShoulderRight =
      this.shoulderRightChannel.update(delta) * this.shoulderWeight * authority

    const spine = this.vrm.humanoid.getNormalizedBoneNode('spine')
    if (spine) {
      spine.rotation.x += nextSpinePitch - this.spinePitch
      spine.rotation.z += nextSpineRoll - this.spineRoll
    }
    const chest = this.vrm.humanoid.getNormalizedBoneNode('chest')
    if (chest) chest.rotation.y += nextChestYaw - this.chestYaw
    const leftShoulder = this.vrm.humanoid.getNormalizedBoneNode('leftShoulder')
    if (leftShoulder) leftShoulder.rotation.z += nextShoulderLeft - this.shoulderLeft
    const rightShoulder = this.vrm.humanoid.getNormalizedBoneNode('rightShoulder')
    if (rightShoulder) rightShoulder.rotation.z += nextShoulderRight - this.shoulderRight

    this.spinePitch = nextSpinePitch
    this.spineRoll = nextSpineRoll
    this.chestYaw = nextChestYaw
    this.shoulderLeft = nextShoulderLeft
    this.shoulderRight = nextShoulderRight
  }

  private updateHeadImpulse(): void {
    if (!this.vrm?.humanoid) return
    const impulse = this.getImpulseEnvelope() * this.headAuthority
    const nextX = this.impulseHeadX * impulse
    const nextY = this.impulseHeadY * impulse
    const head = this.vrm.humanoid.getNormalizedBoneNode('head')
    if (head) {
      head.rotation.x += nextX - this.headOffsetX
      head.rotation.y += nextY - this.headOffsetY
    }
    this.headOffsetX = nextX
    this.headOffsetY = nextY
  }

  private updateEyeImpulse(): void {
    if (!this.vrm?.humanoid) return
    if (this.lookAtActive) {
      this.removeEyeOffsets()
      return
    }

    const impulse = this.getImpulseEnvelope()
    const nextX = this.impulseEyeX * impulse
    const nextY = this.impulseEyeY * impulse
    const leftEye = this.vrm.humanoid.getNormalizedBoneNode('leftEye')
    const rightEye = this.vrm.humanoid.getNormalizedBoneNode('rightEye')
    if (leftEye) {
      leftEye.rotation.x += nextX - this.leftEyeOffsetX
      leftEye.rotation.y += nextY - this.leftEyeOffsetY
    }
    if (rightEye) {
      rightEye.rotation.x += nextX - this.rightEyeOffsetX
      rightEye.rotation.y += nextY - this.rightEyeOffsetY
    }
    this.leftEyeOffsetX = nextX
    this.leftEyeOffsetY = nextY
    this.rightEyeOffsetX = nextX
    this.rightEyeOffsetY = nextY
  }

  private removeEyeOffsets(): void {
    if (this.vrm?.humanoid) {
      const leftEye = this.vrm.humanoid.getNormalizedBoneNode('leftEye')
      if (leftEye) {
        leftEye.rotation.x -= this.leftEyeOffsetX
        leftEye.rotation.y -= this.leftEyeOffsetY
      }
      const rightEye = this.vrm.humanoid.getNormalizedBoneNode('rightEye')
      if (rightEye) {
        rightEye.rotation.x -= this.rightEyeOffsetX
        rightEye.rotation.y -= this.rightEyeOffsetY
      }
    }
    this.leftEyeOffsetX = 0
    this.leftEyeOffsetY = 0
    this.rightEyeOffsetX = 0
    this.rightEyeOffsetY = 0
  }

  private resetAppliedBodyOffsets(): void {
    this.spinePitch = 0
    this.spineRoll = 0
    this.chestYaw = 0
    this.shoulderLeft = 0
    this.shoulderRight = 0
    this.headOffsetX = 0
    this.headOffsetY = 0
  }

  private resetOffsets(): void {
    this.resetAppliedBodyOffsets()
    this.leftEyeOffsetX = 0
    this.leftEyeOffsetY = 0
    this.rightEyeOffsetX = 0
    this.rightEyeOffsetY = 0
  }

  private updateImpulse(delta: number): void {
    if (this.impulseTime <= 0) return
    this.impulseTime = Math.max(0, this.impulseTime - Math.max(0, delta))
    if (this.impulseTime === 0) this.clearImpulse()
  }

  private getImpulseEnvelope(): number {
    if (this.impulseTime <= 0) return 0
    const progress = 1 - this.impulseTime / this.impulseDuration
    return progress < 0.35 ? smoothUnit(progress / 0.35) : 1 - smoothUnit((progress - 0.35) / 0.65)
  }

  private clearImpulse(): void {
    this.impulseTime = 0
    this.impulseHeadX = 0
    this.impulseHeadY = 0
    this.impulseEyeX = 0
    this.impulseEyeY = 0
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function clampSigned(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
}
