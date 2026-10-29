import type { VRM } from '@pixiv/three-vrm'

import { postureShiftTuning } from '../../tuning/motionTuning'
import type { AvatarProceduralMode } from '../types'
import { SeededRandom } from './SeededMotion'

export interface PostureOrientation {
  yaw: number
  pitch: number
  roll: number
}

export interface PostureShiftDebugState {
  torsoYaw: number
  torsoPitch: number
  torsoRoll: number
  weightShift: number
  authority: number
}

interface Contribution {
  hipsRoll: number
  spineYaw: number
  spinePitch: number
  spineRoll: number
  chestYaw: number
  chestRoll: number
}

const zero = (): Contribution => ({
  hipsRoll: 0,
  spineYaw: 0,
  spinePitch: 0,
  spineRoll: 0,
  chestYaw: 0,
  chestRoll: 0,
})

/**
 * Upper-body posture under the procedural owner: the spine/chest carry their
 * share of the current head orientation, and weight occasionally shifts from
 * one leg to the other (pelvis roll, compensated up the spine). Contributions
 * are additive and removed once per frame like the other procedural layers;
 * planted-foot IK and final safety run after them.
 */
export class PostureShiftController {
  private vrm: VRM | null = null
  private readonly random = new SeededRandom(0x2c1b3c6d)
  private mode: AvatarProceduralMode = 'idle'
  private orientation: PostureOrientation = { yaw: 0, pitch: 0, roll: 0 }
  private targetAuthority = 1
  private authority = 1
  private weightShift = 0
  private weightVelocity = 0
  private weightTarget = 0
  private dwellSeconds = 0
  private speechEnergy = 0
  private lean = 0
  private applied: Contribution = zero()

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm
  }

  detach(): void {
    this.remove()
    this.vrm = null
    this.orientation = { yaw: 0, pitch: 0, roll: 0 }
    this.weightShift = 0
    this.weightVelocity = 0
    this.weightTarget = 0
    this.dwellSeconds = 0
    this.speechEnergy = 0
    this.lean = 0
  }

  setMode(mode: AvatarProceduralMode): void {
    this.mode = mode
  }

  setSpeechEnergy(energy: number): void {
    this.speechEnergy = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0
  }

  setOrientation(orientation: PostureOrientation): void {
    this.orientation = { ...orientation }
  }

  /** Smoothed: a body-layer change never steps the torso. */
  setAuthority(weight: number): void {
    this.targetAuthority = Math.max(0, Math.min(1, weight))
  }

  remove(): void {
    this.write(this.applied, -1)
    this.applied = zero()
  }

  update(delta: number): void {
    if (!this.vrm?.humanoid) return
    const step = Math.min(0.05, Math.max(0, delta))
    const tuning = postureShiftTuning
    this.authority +=
      (this.targetAuthority - this.authority) * (1 - Math.exp(-tuning.authoritySmoothing * step))
    this.dwellSeconds -= step
    if (this.dwellSeconds <= 0) {
      const profile = tuning.weightShift[this.mode === 'speaking' ? 'speaking' : 'quiet']
      const side = this.weightTarget > 0 ? -1 : this.weightTarget < 0 ? 1 : this.randomSide()
      this.weightTarget =
        this.random.next() < profile.centerChance
          ? 0
          : side * this.random.range(profile.amplitude.min, profile.amplitude.max)
      this.dwellSeconds = this.random.range(profile.dwellSeconds.min, profile.dwellSeconds.max)
    }
    const damping = 2 * Math.sqrt(tuning.weightStiffness)
    this.weightVelocity +=
      (tuning.weightStiffness * (this.weightTarget - this.weightShift) -
        damping * this.weightVelocity) *
      step
    this.weightShift += this.weightVelocity * step
    const leanTarget =
      this.mode === 'speaking' ? -tuning.engagementLean * Math.min(1, this.speechEnergy / 0.3) : 0
    this.lean += (leanTarget - this.lean) * (1 - Math.exp(-tuning.engagementSmoothing * step))

    const torso = this.authority
    const weight = this.weightShift * this.authority
    const next: Contribution = {
      hipsRoll: weight,
      spineYaw: this.orientation.yaw * tuning.spineShare * torso,
      spinePitch: (this.orientation.pitch * tuning.spineShare + this.lean) * torso,
      spineRoll: this.orientation.roll * tuning.spineShare * torso - weight * 0.7,
      chestYaw: this.orientation.yaw * (1 - tuning.spineShare) * torso,
      chestRoll: this.orientation.roll * (1 - tuning.spineShare) * torso - weight * 0.3,
    }
    const difference = zero()
    for (const key of Object.keys(next) as Array<keyof Contribution>)
      difference[key] = next[key] - this.applied[key]
    this.write(difference, 1)
    this.applied = next
  }

  getDebugState(): PostureShiftDebugState {
    return {
      torsoYaw: this.applied.spineYaw + this.applied.chestYaw,
      torsoPitch: this.applied.spinePitch,
      torsoRoll: this.applied.spineRoll + this.applied.chestRoll,
      weightShift: this.applied.hipsRoll,
      authority: this.authority,
    }
  }

  private randomSide(): number {
    return this.random.next() < 0.5 ? -1 : 1
  }

  private write(value: Contribution, sign: 1 | -1): void {
    const humanoid = this.vrm?.humanoid
    if (!humanoid) return
    const hips = humanoid.getNormalizedBoneNode('hips')
    if (hips) hips.rotation.z += value.hipsRoll * sign
    const spine = humanoid.getNormalizedBoneNode('spine')
    if (spine) {
      spine.rotation.y += value.spineYaw * sign
      spine.rotation.x += value.spinePitch * sign
      spine.rotation.z += value.spineRoll * sign
    }
    const chest = humanoid.getNormalizedBoneNode('chest')
    if (chest) {
      chest.rotation.y += value.chestYaw * sign
      chest.rotation.z += value.chestRoll * sign
    }
  }
}
