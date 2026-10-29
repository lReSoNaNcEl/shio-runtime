import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { SomaHandRetargeting } from '../../../src/renderer/avatar/rendering/three/SomaHandRetargeting'
import { HAND_BONE_NAMES, type MotionChunk } from '../../../src/shared/motion'

function fixture() {
  const scene = new THREE.Group()
  scene.rotation.y = 0.6
  const bones = new Map<string, THREE.Object3D>()
  for (const side of ['left', 'right'] as const) {
    const wrist = new THREE.Bone()
    wrist.rotation.set(0.2, -0.4, 0.1)
    scene.add(wrist)
    bones.set(`${side}Hand`, wrist)
    for (const [finger, lateral] of [
      ['Thumb', -0.04],
      ['Index', -0.02],
      ['Middle', 0],
      ['Ring', 0.02],
      ['Little', 0.04],
    ] as const) {
      let parent: THREE.Object3D = wrist
      for (const [index, part] of (finger === 'Thumb'
        ? ['Metacarpal', 'Proximal', 'Distal']
        : ['Proximal', 'Intermediate', 'Distal']
      ).entries()) {
        const bone = new THREE.Bone()
        bone.position.set(index === 0 ? lateral : 0, 0.025, 0)
        bone.rotation.z = 0.03 * index
        parent.add(bone)
        bones.set(`${side}${finger}${part}`, bone)
        parent = bone
      }
    }
  }
  scene.updateMatrixWorld(true)
  const vrm = {
    scene,
    humanoid: { getNormalizedBoneNode: (name: VRMHumanBoneName) => bones.get(name) },
  } as unknown as VRM
  const deltas = Array.from({ length: 60 }, () => HAND_BONE_NAMES.map(() => [0, 0, 0, 1]))
  const chunk = {
    handDeltas: {
      modelRevision: '233e9225c1da05c6a3dd98107b9f027f2366e3b972bbe67e0d164e5d28619fff',
      basis: { left: [0, 0, 0, 1], right: [0, 0, 0, 1] },
      rotations: deltas,
    },
  } as MotionChunk
  return { bones, chunk, retarget: new SomaHandRetargeting(vrm) }
}

describe('SOMA-X hand contribution', () => {
  it('preserves the complete finger rest pose under a rotated wrist and model without applying the wrist twice', () => {
    const { bones, chunk, retarget } = fixture()
    const before = new Map([...bones].map(([name, bone]) => [name, bone.quaternion.clone()]))
    const pose = retarget.sample(chunk, 10, 0.5)
    expect(pose?.size).toBe(30)
    for (const name of HAND_BONE_NAMES) {
      expect(pose?.get(name)?.angleTo(before.get(name) ?? new THREE.Quaternion())).toBeLessThan(
        1e-7,
      )
    }
    for (const [name, bone] of bones)
      expect(bone.quaternion.angleTo(before.get(name) ?? new THREE.Quaternion())).toBeLessThan(1e-7)
    expect(pose?.has('leftHand')).toBe(false)
    expect(pose?.has('rightHand')).toBe(false)
  })

  it('uses the following horizon for continuous interpolation across the transport boundary', () => {
    const { chunk, retarget } = fixture()
    const following = structuredClone(chunk)
    const angle = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2).toArray()
    following.handDeltas?.rotations[0].forEach((rotation, index) => {
      if (index < 3) rotation.splice(0, 4, ...angle)
    })
    const first = retarget.sample(chunk, 59, 0, following)
    const halfway = retarget.sample(chunk, 59, 0.5, following)
    const endpoint = retarget.sample(following, 0, 0)
    const name = 'leftThumbMetacarpal'
    expect(first?.get(name)?.angleTo(halfway?.get(name) ?? new THREE.Quaternion())).toBeCloseTo(
      0.1,
      6,
    )
    expect(halfway?.get(name)?.angleTo(endpoint?.get(name) ?? new THREE.Quaternion())).toBeCloseTo(
      0.1,
      6,
    )
  })

  it('retains the original hand domain for body-only providers', () => {
    const { retarget } = fixture()
    expect(retarget.sample({} as MotionChunk, 0, 0)).toBeNull()
  })
})
