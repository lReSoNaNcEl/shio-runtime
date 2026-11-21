import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'

import { HAND_BONE_NAMES, MOTION_CATALOG, type MotionProfile } from '../../../../shared/motion'

/** FlashMotion transport slots for normalized VRM body rotation deltas. */
export const BONES: ReadonlyArray<[number, VRMHumanBoneName]> = [
  [0, 'hips'],
  [1, 'spine'],
  [2, 'chest'],
  [3, 'upperChest'],
  [16, 'rightShoulder'],
  [17, 'rightUpperArm'],
  [18, 'rightLowerArm'],
  [19, 'rightHand'],
  [10, 'leftShoulder'],
  [11, 'leftUpperArm'],
  [12, 'leftLowerArm'],
  [13, 'leftHand'],
  [26, 'rightUpperLeg'],
  [27, 'rightLowerLeg'],
  [28, 'rightFoot'],
  [29, 'rightToes'],
  [22, 'leftUpperLeg'],
  [23, 'leftLowerLeg'],
  [24, 'leftFoot'],
  [25, 'leftToes'],
]

export interface Binding {
  index: number
  name: VRMHumanBoneName
  bone: THREE.Object3D
  restInModel: THREE.Quaternion
  filteredLocal: THREE.Quaternion
  safe: THREE.Quaternion
  calibratedSafe: THREE.Quaternion
  sourceTarget?: THREE.Quaternion
}

export interface PlantedFoot {
  upper: THREE.Object3D
  lower: THREE.Object3D
  foot: THREE.Object3D
  target: THREE.Vector3
  orientation: THREE.Quaternion
  pole: THREE.Vector3
}

/** Binds each generated body joint to its normalized VRM bone and standing rest. */
export function createBindings(
  vrm: VRM,
  axis: THREE.Vector3,
  sign: number,
  inverseModel: THREE.Quaternion,
): Binding[] {
  return BONES.flatMap(([index, name]) => {
    const bone = vrm.humanoid.getNormalizedBoneNode(name)
    if (!bone) return []
    const safe = bone.quaternion.clone()
    if (name === 'rightUpperArm')
      safe.multiply(new THREE.Quaternion().setFromAxisAngle(axis, sign * 1.15))
    if (name === 'leftUpperArm')
      safe.multiply(new THREE.Quaternion().setFromAxisAngle(axis, -sign * 1.15))
    return [
      {
        index,
        name,
        bone,
        restInModel: bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverseModel),
        filteredLocal: safe.clone(),
        safe,
        calibratedSafe: safe.clone(),
      },
    ]
  })
}

/** Measures the planted support of both legs on the current standing pose. */
export function measurePlantedFeet(vrm: VRM, sign: number): PlantedFoot[] {
  return (['left', 'right'] as const).flatMap((side) => {
    const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`)
    const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`)
    const foot = vrm.humanoid.getNormalizedBoneNode(`${side}Foot`)
    return upper && lower && foot
      ? [
          {
            upper,
            lower,
            foot,
            target: foot.getWorldPosition(new THREE.Vector3()),
            orientation: foot.getWorldQuaternion(new THREE.Quaternion()),
            pole: new THREE.Vector3(0, 0, sign).applyQuaternion(
              vrm.scene.getWorldQuaternion(new THREE.Quaternion()),
            ),
          },
        ]
      : []
  })
}

/** Bounds standing root height so a planted knee never changes faster than
 * 0.9 rad/s; the planted feet stay the support authority. */
export function limitStandingRootY(
  vrm: VRM | null,
  plantedFeet: readonly PlantedFoot[],
  rootAnchor: THREE.Vector3,
  filteredRootY: number,
  requested: number,
  seconds: number,
): number {
  const hips = vrm?.humanoid.getNormalizedBoneNode('hips')
  if (!hips) return requested
  const parent = hips.parent
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
    parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion(),
  )
  const scale = Math.max(0.001, Math.abs(parent?.getWorldScale(new THREE.Vector3()).y ?? 1))
  let result = requested
  for (const leg of plantedFeet) {
    const origin = leg.upper
      .getWorldPosition(new THREE.Vector3())
      .addScaledVector(up, (rootAnchor.y - hips.position.y) * scale)
    const a = leg.upper
      .getWorldPosition(new THREE.Vector3())
      .distanceTo(leg.lower.getWorldPosition(new THREE.Vector3()))
    const b = leg.lower
      .getWorldPosition(new THREE.Vector3())
      .distanceTo(leg.foot.getWorldPosition(new THREE.Vector3()))
    if (a < 0.001 || b < 0.001) continue
    const bend = (value: number): number => {
      const distance = origin
        .clone()
        .addScaledVector(up, (value - rootAnchor.y) * scale)
        .distanceTo(leg.target)
      return Math.acos(
        THREE.MathUtils.clamp((distance * distance - a * a - b * b) / (2 * a * b), -1, 1),
      )
    }
    const before = bend(filteredRootY),
      after = bend(result)
    const change = 0.9 * seconds
    if (Math.abs(after - before) <= change) continue
    const angle = before + Math.sign(after - before) * change
    const distanceSquared = a * a + b * b + 2 * a * b * Math.cos(angle)
    const delta = origin.clone().sub(leg.target)
    const height = delta.dot(up)
    const horizontalSquared = Math.max(0, delta.lengthSq() - height * height)
    const allowed =
      rootAnchor.y + (Math.sqrt(Math.max(0, distanceSquared - horizontalSquared)) - height) / scale
    result = THREE.MathUtils.clamp(
      allowed,
      Math.min(filteredRootY, result),
      Math.max(filteredRootY, result),
    )
  }
  return result
}

/** Whether the rig has every bone the generated body and the profile's hand workspaces need. */
export function profileRigSupported(vrm: VRM, profile: MotionProfile): boolean {
  const required = [
    ...HAND_BONE_NAMES,
    'leftHand',
    'rightHand',
    'hips',
    'spine',
    'leftUpperLeg',
    'leftLowerLeg',
    'rightUpperLeg',
    'rightLowerLeg',
    'leftUpperArm',
    'leftLowerArm',
    'rightUpperArm',
    'rightLowerArm',
    'leftFoot',
    'rightFoot',
  ] as const
  if (required.some((name) => !vrm.humanoid.getNormalizedBoneNode(name))) return false
  const anchors = Object.values(profile.handScore.phases).flatMap((pair) =>
    Object.values(pair)
      .filter((hand) => hand.workspace !== 'relaxed')
      .map((hand) => MOTION_CATALOG.handWorkspaces[hand.workspace].anchor),
  )
  if (anchors.some((name) => !vrm.humanoid.getNormalizedBoneNode(name))) return false
  return true
}
