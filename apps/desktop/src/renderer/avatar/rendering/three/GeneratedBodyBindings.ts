import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'

/** SOMA30 to VRM bone bindings and planted-foot anchors of the generated body.
 * Moved verbatim from GeneratedBodyPlayback; the owner keeps all state. */

// SOMA30 standard T-pose, Y up, metres, world xyzw rotations. No head/neck,
// facial, jaw, eye or finger source is admitted through this body mapping.
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

/** Binds each mapped SOMA30 joint to its normalized VRM bone and standing rest. */
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
