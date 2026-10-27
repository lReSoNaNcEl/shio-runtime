import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import { BODY_BONE_NAMES } from '../../../src/shared/motion'

/** Flat normalized bones for lifecycle tests; deliberately not a real-rig geometry fixture. */
export function createMinimalVrm(
  options: {
    extraBones?: string[]
    hipsHeight?: number
    metaVersion?: string
    sceneYaw?: number
  } = {},
) {
  const scene = new THREE.Scene()
  scene.rotation.y = options.sceneYaw ?? 0
  const bones = new Map<string, THREE.Object3D>()
  for (const name of [...BODY_BONE_NAMES, ...(options.extraBones ?? [])]) {
    const bone = new THREE.Object3D()
    scene.add(bone)
    bones.set(name, bone)
  }
  bones.get('hips')?.position.set(0, options.hipsHeight ?? 0.9887084839474641, 0)
  const vrm = {
    scene,
    meta: { metaVersion: options.metaVersion ?? '1' },
    humanoid: { getNormalizedBoneNode: (name: string) => bones.get(name) ?? null },
  } as unknown as VRM
  return { scene, bones, vrm }
}
