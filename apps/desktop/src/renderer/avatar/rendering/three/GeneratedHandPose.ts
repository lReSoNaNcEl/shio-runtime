import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'

import {
  getMotionProfile,
  HAND_BONE_NAMES,
  MOTION_CATALOG,
  type MotionPhaseId,
} from '../../../../shared/motion'

type HandPose = ReadonlyMap<VRMHumanBoneName, THREE.Quaternion>
const FINGERS = ['index', 'middle', 'ring', 'little'] as const
const JOINTS = ['Proximal', 'Intermediate', 'Distal'] as const
const smoothstep = (v: number): number => {
  const t = THREE.MathUtils.clamp(v, 0, 1)
  return t * t * (3 - 2 * t)
}

/** Positive authored spread points toward the index side of the measured palm. */
export function calibrateFingerSpreadSigns(vrm: VRM): ReadonlyMap<VRMHumanBoneName, number> {
  const signs = new Map<VRMHumanBoneName, number>()
  vrm.scene.updateMatrixWorld(true)
  for (const side of ['left', 'right'] as const) {
    const index = vrm.humanoid.getNormalizedBoneNode(`${side}IndexProximal`)
    const little = vrm.humanoid.getNormalizedBoneNode(`${side}LittleProximal`)
    if (!index || !little) continue
    const across = index
      .getWorldPosition(new THREE.Vector3())
      .sub(little.getWorldPosition(new THREE.Vector3()))
    if (across.lengthSq() < 1e-10) continue
    across.normalize()
    for (const finger of [...FINGERS, 'thumb'] as const) {
      const prefix = `${side}${finger[0].toUpperCase()}${finger.slice(1)}`
      const name = `${prefix}${finger === 'thumb' ? 'Metacarpal' : 'Proximal'}` as VRMHumanBoneName
      const proximal = vrm.humanoid.getNormalizedBoneNode(name)
      const child = vrm.humanoid.getNormalizedBoneNode(
        `${prefix}${finger === 'thumb' ? 'Proximal' : 'Intermediate'}` as VRMHumanBoneName,
      )
      if (!proximal || !child) continue
      const direction = child
        .getWorldPosition(new THREE.Vector3())
        .sub(proximal.getWorldPosition(new THREE.Vector3()))
        .normalize()
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(
        proximal.getWorldQuaternion(new THREE.Quaternion()),
      )
      const derivative = axis.cross(direction).dot(across)
      if (Math.abs(derivative) > 1e-5)
        signs.set(name, Math.sign(derivative) * (side === 'left' ? -1 : 1))
    }
  }
  return signs
}

/** Calibrated hand contribution; the body owner supplies execution, phase and cursor. */
export class GeneratedHandPose {
  private readonly rest = new Map<VRMHumanBoneName, THREE.Quaternion>()
  private from: HandPose = new Map()
  private last: HandPose = new Map()
  private wrists: HandPose = new Map()
  private fromWrists: HandPose = new Map()
  private key = ''
  private error = 0
  private readonly spreadSigns: ReadonlyMap<VRMHumanBoneName, number>

  constructor(
    restPose: HandPose = new Map(),
    spreadSigns: ReadonlyMap<VRMHumanBoneName, number> = new Map(),
  ) {
    this.spreadSigns = new Map(spreadSigns)
    for (const name of HAND_BONE_NAMES)
      this.rest.set(name, restPose.get(name)?.clone() ?? new THREE.Quaternion())
  }

  reset(pose: HandPose = new Map()): void {
    this.from = pose
    this.last = pose
    this.wrists = new Map()
    this.fromWrists = new Map()
    this.key = ''
    this.error = 0
  }

  sample(profileId: string, seconds: number, seed: number, metaVersion = '1'): HandPose {
    return this.sampleScore(
      profileId,
      `${profileId}:${seed}`,
      'hold',
      Math.max(0, seconds) / 0.35,
      metaVersion,
    )
  }

  sampleScore(
    profileId: string,
    executionId: string,
    phase: MotionPhaseId,
    progress: number,
    metaVersion = '1',
  ): HandPose {
    const profile = getMotionProfile(profileId)
    if (!profile) return this.last
    const key = `${executionId}:${phase}`
    if (this.key !== key) {
      this.from = this.last.size ? this.last : this.rest
      this.fromWrists = this.wrists
      this.key = key
    }
    const result = new Map<VRMHumanBoneName, THREE.Quaternion>()
    const wrists = new Map<VRMHumanBoneName, THREE.Quaternion>()
    const calibration = MOTION_CATALOG.handRigCalibration
    const versionSign = metaVersion === '0' ? -1 : 1
    this.error = 0
    for (const side of ['left', 'right'] as const) {
      const target = profile.handScore.phases[phase][side]
      const blend = smoothstep(
        (progress - target.timing.start) / (target.timing.end - target.timing.start),
      )
      const sign = (side === 'left' ? calibration.leftSign : calibration.rightSign) * versionSign
      for (const finger of [...FINGERS, 'thumb'] as const) {
        const shape = target.fingers[finger]
        const names = finger === 'thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : JOINTS
        for (let joint = 0; joint < 3; joint += 1) {
          const name = (side +
            finger[0].toUpperCase() +
            finger.slice(1) +
            names[joint]) as VRMHumanBoneName
          const delta = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              finger === 'thumb' && joint === 0 ? sign * shape.opposition : 0,
              joint === 0 ? (this.spreadSigns.get(name) ?? sign) * shape.spread : 0,
              sign * shape.curl[joint],
              'YXZ',
            ),
          )
          const rotation = (this.rest.get(name) ?? new THREE.Quaternion()).clone().multiply(delta)
          const applied = (this.from.get(name) ?? rotation)
            .clone()
            .slerp(rotation, blend)
            .normalize()
          this.error = Math.max(this.error, applied.angleTo(rotation))
          result.set(name, applied)
        }
      }
      const name = `${side}Hand` as const
      const [x, y, z] = target.wristEuler
      const targetWrist = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(x, sign * y, sign * z, 'YXZ'),
      )
      const wrist = (this.fromWrists.get(name) ?? new THREE.Quaternion())
        .clone()
        .slerp(targetWrist, blend)
      this.error = Math.max(this.error, wrist.angleTo(targetWrist))
      wrists.set(name, wrist)
    }
    this.last = result
    this.wrists = wrists
    return result
  }

  transitionError(profileId: string): number {
    const candidate = new GeneratedHandPose(this.rest, this.spreadSigns)
    const fingers = candidate.sampleScore(profileId, 'transition-probe', 'prepare', 1)
    let maximum = 0
    for (const [name, target] of fingers)
      maximum = Math.max(
        maximum,
        (this.last.get(name) ?? this.rest.get(name) ?? target).angleTo(target),
      )
    for (const [name, target] of candidate.getWristOffsets())
      maximum = Math.max(maximum, (this.wrists.get(name) ?? new THREE.Quaternion()).angleTo(target))
    return maximum
  }

  getWristOffsets(): HandPose {
    return this.wrists
  }
  targetsReached(): boolean {
    return this.error < 0.025
  }
}
