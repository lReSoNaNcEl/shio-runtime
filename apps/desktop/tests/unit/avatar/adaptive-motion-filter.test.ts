import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { AdaptiveMotionFilter } from '../../../src/renderer/avatar/rendering/three/AdaptiveMotionFilter'

const axis = new THREE.Vector3(0, 0, 1)
describe('single source-aware body tracking', () => {
  it('returns a quiet presence wrist within its existing recovery budget without raising its speed ceiling', () => {
    const filter = new AdaptiveMotionFilter()
    const bone = new THREE.Object3D()
    const from = new THREE.Quaternion().setFromAxisAngle(axis, 0.8)
    const rest = new THREE.Quaternion()
    bone.quaternion.copy(from)
    for (let frame = 0; frame < 156; frame++) {
      const elapsed = frame / 60
      const t = Math.min(1, (elapsed + 1 / 60) / 0.9)
      const previous = bone.quaternion.clone()
      filter.step(bone, previous, from.clone().slerp(rest, t * t * (3 - 2 * t)), 1 / 60, {
        sourceProvider: 'motionbricks',
        motionClass: 'presence',
        phase: 'recover',
        reachSeconds: Math.max(0.25, 0.9 - elapsed),
        sourceSpeeds: new Map([[bone, 0]]),
        jointKinds: new Map([[bone, 'wrist']]),
      })
      expect(previous.angleTo(bone.quaternion) * 60).toBeLessThanOrEqual(1.201)
    }
    expect(bone.quaternion.angleTo(rest)).toBeLessThan(0.06)
  })
  it('allows a large MotionBricks preparation to take physical time without slowing the stroke tracker', () => {
    const filter = new AdaptiveMotionFilter()
    const bone = new THREE.Object3D()
    const target = new THREE.Quaternion().setFromAxisAngle(axis, 2.4)
    for (let frame = 0; frame < 150; frame++) {
      const previous = bone.quaternion.clone()
      filter.step(bone, previous, target, 1 / 60, {
        sourceProvider: 'motionbricks',
        motionClass: 'gesture',
        phase: 'prepare',
        reachSeconds: 0.55,
        sourceSpeeds: new Map([[bone, 6]]),
      })
      expect(previous.angleTo(bone.quaternion) * 60).toBeLessThanOrEqual(1.501)
    }
    expect(bone.quaternion.angleTo(target)).toBeLessThan(0.03)
  })
  it('rejects rapid MotionBricks presence noise while retaining a slow sway and unchanged gesture timing', () => {
    const run = (
      sourceProvider: 'motionbricks' | undefined,
      motionClass: 'presence' | 'gesture',
    ) => {
      const filter = new AdaptiveMotionFilter()
      const bone = new THREE.Object3D()
      const angles: number[] = []
      for (let frame = 0; frame < 1200; frame++) {
        const time = frame / 60
        const angle =
          0.03 * Math.sin(2 * Math.PI * 0.2 * time) + 0.002 * Math.sin(2 * Math.PI * 10 * time)
        const previous = bone.quaternion.clone()
        filter.step(bone, previous, new THREE.Quaternion().setFromAxisAngle(axis, angle), 1 / 60, {
          motionClass,
          phase: 'hold',
          sourceProvider,
        })
        filter.reconcile(bone, previous, 1 / 60)
        if (frame >= 300) angles.push(2 * Math.atan2(bone.quaternion.z, bone.quaternion.w))
      }
      return angles
    }
    const previous = run(undefined, 'presence')
    const candidate = run('motionbricks', 'presence')
    const highEnergy = (angles: number[]) =>
      angles
        .slice(2)
        .reduce(
          (sum, angle, index) => sum + (angle - 2 * angles[index + 1] + angles[index]) ** 2,
          0,
        )
    expect(highEnergy(candidate)).toBeLessThan(highEnergy(previous) * 0.1)
    expect(Math.max(...candidate) - Math.min(...candidate)).toBeGreaterThan(0.056)
    expect(run('motionbricks', 'gesture')).toEqual(run(undefined, 'gesture'))
  })
  it.each([60, 90, 120])(
    'tracks a slow neural path while rejecting tiny source chatter at %i Hz',
    (hz) => {
      const filter = new AdaptiveMotionFilter(),
        bone = new THREE.Object3D()
      let sumError = 0,
        samples = 0,
        maximumStep = 0
      const errors: number[] = []
      for (let frame = 0; frame < hz * 4; frame++) {
        const time = frame / hz
        const slow = 0.03 * Math.sin(time * 2)
        const target = new THREE.Quaternion().setFromAxisAngle(
          axis,
          slow + 0.001 * Math.sin(time * 2 * Math.PI * 12),
        )
        const previous = bone.quaternion.clone()
        filter.step(bone, previous, target, 1 / hz, { motionClass: 'presence', phase: 'hold' })
        filter.reconcile(bone, previous, 1 / hz)
        if (time > 1) {
          sumError +=
            bone.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(axis, slow)) ** 2
          maximumStep = Math.max(maximumStep, previous.angleTo(bone.quaternion) * hz)
          samples++
          errors.push(2 * Math.atan2(bone.quaternion.z, bone.quaternion.w) - slow)
        }
      }
      const high = errors
        .slice(2)
        .map((value, index) => value - 2 * errors[index + 1] + errors[index])
      expect(Math.sqrt(sumError / samples)).toBeLessThan(0.004)
      // The unfiltered 12 Hz input has a 0.00138 rad second difference at
      // 60 Hz. Retain the slow path while rejecting at least 85% of chatter.
      expect(Math.max(...high.map(Math.abs))).toBeLessThan(0.0002)
      expect(maximumStep).toBeLessThan(0.07)
    },
  )
  it('reaches an admitted preparation target when the held neural source has zero velocity', () => {
    const filter = new AdaptiveMotionFilter(),
      bone = new THREE.Object3D()
    const target = new THREE.Quaternion().setFromAxisAngle(axis, 1.8)
    let speed = 0
    for (let frame = 0; frame < 72; frame++) {
      const previous = bone.quaternion.clone()
      filter.step(bone, previous, target, 1 / 60, {
        motionClass: 'gesture',
        phase: 'prepare',
        sourceSpeeds: new Map([[bone, 0]]),
        reachSeconds: Math.max(0.25, 0.8 - frame / 60),
      })
      speed = Math.max(speed, previous.angleTo(bone.quaternion) * 60)
    }
    expect(bone.quaternion.angleTo(target)).toBeLessThan(0.05)
    expect(speed).toBeLessThanOrEqual(6.001)
  })
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
