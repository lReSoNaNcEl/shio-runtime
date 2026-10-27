import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { ProceduralMotionController } from '../../../src/renderer/avatar/embodiment/motion/ProceduralMotionController'

function fixture() {
  const names = ['spine', 'chest', 'leftShoulder', 'rightShoulder', 'head', 'leftEye', 'rightEye']
  const bones = new Map(names.map((name) => [name, new THREE.Object3D()]))
  const vrm = {
    humanoid: { getNormalizedBoneNode: (name: string) => bones.get(name) },
  } as unknown as VRM
  const motion = new ProceduralMotionController()
  motion.attach(vrm)
  return { bones, motion }
}

function expectBodyAtRest(bones: Map<string, THREE.Object3D>) {
  for (const name of ['spine', 'chest', 'leftShoulder', 'rightShoulder']) {
    const bone = bones.get(name)
    expect(bone?.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.000001)
    expect(bone?.position.length()).toBeLessThan(0.000001)
  }
}

describe('Overlay procedural body ownership', () => {
  it('preserves the mirrored body while keeping head and eye impulses alive', () => {
    const { bones, motion } = fixture()
    motion.setPresentationOnly(true)
    motion.setMode('speaking')
    motion.setBodyMotionLayer('gesture')
    motion.setLookAtMode('speaking')
    motion.nudge({ headX: 0.04, eyeX: 0.03, duration: 3 })
    motion.update(0.4)
    expectBodyAtRest(bones)
    expect(Math.abs(bones.get('head')?.rotation.x ?? 0)).toBeGreaterThan(0)
    expect(Math.abs(bones.get('leftEye')?.rotation.x ?? 0)).toBeGreaterThan(0)
    motion.remove()
    expectBodyAtRest(bones)
    motion.detach()
  })

  it('removes previous body offsets once and can restore primary composition', () => {
    const { bones, motion } = fixture()
    for (let frame = 0; frame < 30; frame += 1) {
      motion.remove()
      motion.update(0.1)
    }
    expect(motion.getDebugState().microMotion.upperBodyAuthority).toBeGreaterThan(0)
    expect(Math.abs(bones.get('chest')?.position.y ?? 0)).toBeGreaterThan(0)
    motion.setPresentationOnly(true)
    motion.setPresentationOnly(true)
    expectBodyAtRest(bones)
    motion.setMode('thinking')
    motion.setBodyMotionLayer('base')
    for (let frame = 0; frame < 30; frame += 1) {
      motion.remove()
      motion.update(0.1)
    }
    expectBodyAtRest(bones)
    expect(motion.getDebugState().microMotion.upperBodyAuthority).toBe(0)
    motion.setPresentationOnly(false)
    motion.setPresentationOnly(false)
    motion.update(0.1)
    expect(motion.getDebugState().microMotion.upperBodyAuthority).toBeGreaterThan(0)
    expect(Math.abs(bones.get('chest')?.position.y ?? 0)).toBeGreaterThan(0)
    motion.detach()
    expectBodyAtRest(bones)
  })
})
