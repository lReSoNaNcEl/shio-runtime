import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import { HAND_BONE_NAMES } from '../../../../shared/motion'

/** Transient presentation bounds of the composed hand, never a pose correction. */
export function previewHandBounds(vrm: VRM | null, side: 'left' | 'right'): THREE.Sphere | null {
  const wrist = vrm?.humanoid.getNormalizedBoneNode(`${side}Hand`)
  if (!vrm || !wrist) return null
  const box = new THREE.Box3().expandByPoint(wrist.getWorldPosition(new THREE.Vector3()))
  for (const name of HAND_BONE_NAMES) {
    if (!name.startsWith(side)) continue
    const bone = vrm.humanoid.getNormalizedBoneNode(name)
    if (!bone) continue
    const point = bone.getWorldPosition(new THREE.Vector3())
    box.expandByPoint(point)
    if (name.endsWith('Distal') && bone.parent) {
      const segment = point.clone().sub(bone.parent.getWorldPosition(new THREE.Vector3()))
      box.expandByPoint(point.clone().add(segment))
    }
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  sphere.radius = Math.max(0.001, sphere.radius * 1.15)
  return sphere
}
