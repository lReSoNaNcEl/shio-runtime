import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { AdaptiveMotionFilter } from '../../../src/renderer/avatar/rendering/three/AdaptiveMotionFilter'

const axis = new THREE.Vector3(0, 0, 1)
describe('single source-aware body tracking', () => {
  it('preserves a fast admissible stroke rather than stretching it over seconds', () => {
    const filter = new AdaptiveMotionFilter()
    const bone = new THREE.Object3D()
    bone.name = 'rightLowerArm'
    let maximumError = 0,
      maximumSpeed = 0
    let previous = bone.quaternion.clone()
    for (let frame = 0; frame < 180; frame++) {
      const t = frame / 60
      const angle = t < 0.5 ? 0 : t < 1.1 ? 0.5 * (1 - Math.cos(((t - 0.5) / 0.6) * Math.PI)) : 1
      const target = new THREE.Quaternion().setFromAxisAngle(axis, angle)
      const speed =
        t >= 0.5 && t <= 1.1 ? ((0.5 * Math.PI) / 0.6) * Math.sin(((t - 0.5) / 0.6) * Math.PI) : 0
      filter.step(bone, previous, target, 1 / 60, {
        motionClass: 'gesture',
        phase: 'stroke',
        sourceSpeeds: new Map([[bone, speed]]),
      })
      if (frame > 30) maximumError = Math.max(maximumError, bone.quaternion.angleTo(target))
      maximumSpeed = Math.max(maximumSpeed, previous.angleTo(bone.quaternion) * 60)
      previous = bone.quaternion.clone()
    }
    expect(maximumError).toBeLessThan(0.08)
    expect(maximumSpeed).toBeGreaterThan(2.3)
    expect(bone.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(axis, 1))).toBeLessThan(
      0.002,
    )
  })
  it('bounds a discontinuous horizon and never banks paused time for catch-up', () => {
    const filter = new AdaptiveMotionFilter()
    const bone = new THREE.Object3D()
    bone.name = 'rightUpperArm'
    const target = new THREE.Quaternion().setFromAxisAngle(axis, 1.5)
    const before = bone.quaternion.clone()
    filter.step(bone, before, target, 0, { motionClass: 'gesture', phase: 'stroke' })
    expect(bone.quaternion.angleTo(before)).toBe(0)
    filter.step(bone, before, target, 4, {
      motionClass: 'gesture',
      phase: 'stroke',
      sourceSpeeds: new Map([[bone, 0]]),
    })
    expect(bone.quaternion.angleTo(before)).toBeLessThan(0.05)
    expect(bone.quaternion.angleTo(target)).toBeGreaterThan(1.4)
  })
  it('has a quieter presence envelope and remains invariant to quaternion sign', () => {
    const outputs = [1, -1].map((sign) => {
      const filter = new AdaptiveMotionFilter(),
        bone = new THREE.Object3D()
      const result: number[][] = []
      for (let frame = 0; frame < 120; frame++) {
        const target = new THREE.Quaternion().setFromAxisAngle(axis, 0.03 * Math.sin(frame / 30))
        target.set(target.x * sign, target.y * sign, target.z * sign, target.w * sign)
        filter.step(bone, bone.quaternion.clone(), target, 1 / 60, {
          motionClass: 'presence',
          phase: 'hold',
        })
        result.push(bone.quaternion.toArray())
      }
      return result
    })
    outputs[0].forEach((q, i) => {
      expect(
        new THREE.Quaternion()
          .fromArray(q)
          .angleTo(new THREE.Quaternion().fromArray(outputs[1][i])),
      ).toBeLessThan(1e-7)
    })
  })
})
