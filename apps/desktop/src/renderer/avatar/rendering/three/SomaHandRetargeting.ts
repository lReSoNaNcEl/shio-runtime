import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'

import { HAND_BONE_NAMES, type MotionChunk } from '../../../../shared/motion'

/** Pure hand-domain contribution; only the existing body composer applies it. */
export class SomaHandRetargeting {
  private readonly bindings: Array<{
    name: VRMHumanBoneName
    bone: THREE.Object3D
    wrist: THREE.Object3D
    side: 'left' | 'right'
    index: number
    restInWrist: THREE.Quaternion
    palmInWrist: THREE.Quaternion
  }> = []

  constructor(vrm: VRM) {
    vrm.scene.updateMatrixWorld(true)
    for (const side of ['left', 'right'] as const) {
      const wrist = vrm.humanoid.getNormalizedBoneNode(`${side}Hand`)
      const index = vrm.humanoid.getNormalizedBoneNode(`${side}IndexProximal`)
      const little = vrm.humanoid.getNormalizedBoneNode(`${side}LittleProximal`)
      const middle = vrm.humanoid.getNormalizedBoneNode(`${side}MiddleProximal`)
      if (!wrist || !index || !little || !middle) continue
      const inverse = wrist.getWorldQuaternion(new THREE.Quaternion()).invert()
      const origin = wrist.getWorldPosition(new THREE.Vector3())
      const across = index
        .getWorldPosition(new THREE.Vector3())
        .sub(little.getWorldPosition(new THREE.Vector3()))
        .applyQuaternion(inverse)
        .normalize()
      const along = middle
        .getWorldPosition(new THREE.Vector3())
        .sub(origin)
        .applyQuaternion(inverse)
      along.addScaledVector(across, -along.dot(across)).normalize()
      if (across.lengthSq() < 0.9 || along.lengthSq() < 0.9) continue
      const palm = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(across, along, across.clone().cross(along)),
      )
      HAND_BONE_NAMES.forEach((name, boneIndex) => {
        if (!name.startsWith(side)) return
        const bone = vrm.humanoid.getNormalizedBoneNode(name)
        if (bone)
          this.bindings.push({
            name,
            bone,
            wrist,
            side,
            index: boneIndex,
            palmInWrist: palm,
            restInWrist: inverse.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())),
          })
      })
    }
  }

  sample(
    chunk: MotionChunk,
    frame: number,
    fraction: number,
    following?: MotionChunk,
  ): ReadonlyMap<VRMHumanBoneName, THREE.Quaternion> | null {
    const hands = chunk.handDeltas
    if (!hands) return null
    const result = new Map<VRMHumanBoneName, THREE.Quaternion>()
    const targets = new Map<THREE.Object3D, THREE.Quaternion>()
    for (const binding of this.bindings) {
      const from = hands.rotations[frame][binding.index]
      const to =
        frame < 59
          ? hands.rotations[frame + 1][binding.index]
          : (following?.handDeltas?.rotations[0][binding.index] ?? from)
      const source = new THREE.Quaternion()
        .fromArray(from)
        .slerp(new THREE.Quaternion().fromArray(to), fraction)
      const map = binding.palmInWrist
        .clone()
        .multiply(new THREE.Quaternion().fromArray(hands.basis[binding.side]).invert())
      const delta = map.clone().multiply(source).multiply(map.invert())
      const world = binding.wrist
        .getWorldQuaternion(new THREE.Quaternion())
        .multiply(delta)
        .multiply(binding.restInWrist)
      targets.set(binding.bone, world.clone())
      const parent = binding.bone.parent
      const parentWorld = parent
        ? (targets.get(parent)?.clone() ?? parent.getWorldQuaternion(new THREE.Quaternion()))
        : new THREE.Quaternion()
      result.set(binding.name, parentWorld.invert().multiply(world).normalize())
    }
    return result
  }
}
