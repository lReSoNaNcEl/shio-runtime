import * as THREE from 'three'

import type { MotionChunk } from '../../../../shared/motion'

interface Segment {
  bone: THREE.Object3D
  child: THREE.Object3D
  index: number
  restInModel: THREE.Quaternion
}

/** Transient FK envelope from an existing neural horizon, in the loaded rig's
 * metres. It samples no new motion and never writes to the model. */
export function sourceHandDisplacements(
  chunk: MotionChunk,
  segments: readonly Segment[],
  modelWorld: THREE.Quaternion,
  vrm0: boolean,
  first: number,
  count: number,
): THREE.Vector3[] {
  const local = segments.map(({ bone, child }) =>
    child
      .getWorldPosition(new THREE.Vector3())
      .sub(bone.getWorldPosition(new THREE.Vector3()))
      .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert()),
  )
  const points: THREE.Vector3[] = []
  for (let frame = first; frame < Math.min(60, first + count); frame++) {
    const point = new THREE.Vector3()
    segments.forEach(({ index, restInModel }, i) => {
      const rotation = new THREE.Quaternion().fromArray(chunk.rotations[frame][index]).normalize()
      if (vrm0) rotation.set(-rotation.x, rotation.y, -rotation.z, rotation.w)
      rotation.multiply(restInModel).premultiply(modelWorld)
      point.add(local[i].clone().applyQuaternion(rotation))
    })
    points.push(point)
  }
  const origin = points[0]?.clone() ?? new THREE.Vector3()
  return points.map((point) => point.sub(origin))
}
