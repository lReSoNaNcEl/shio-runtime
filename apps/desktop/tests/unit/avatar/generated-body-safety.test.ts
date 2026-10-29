import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { GeneratedBodySafety } from '../../../src/renderer/avatar/rendering/three/GeneratedBodySafety'
import { getMotionProfile } from '../../../src/shared/motion'

function fixture(version: '0' | '1' = '0', rotation = 0) {
  const scene = new THREE.Scene(),
    bones = new Map<string, THREE.Object3D>()
  const add = (name: string, parent: THREE.Object3D, position: [number, number, number]) => {
    const bone = new THREE.Object3D()
    bone.position.fromArray(position)
    parent.add(bone)
    bones.set(name, bone)
    return bone
  }
  const hips = add('hips', scene, [0, 0.9, 0])
  add('chest', hips, [0, 0.45, 0])
  for (const side of ['left', 'right'] as const) {
    const s = (side === 'left' ? 1 : -1) * (version === '0' ? -1 : 1)
    const arm = add(`${side}UpperArm`, hips, [s * 0.25, 0.45, 0])
    const elbow = add(`${side}LowerArm`, arm, [s * 0.3, 0, 0])
    add(`${side}Hand`, elbow, [s * 0.28, 0, 0])
    const leg = add(`${side}UpperLeg`, hips, [s * 0.1, 0, 0])
    const knee = add(`${side}LowerLeg`, leg, [0, -0.4, 0])
    add(`${side}Foot`, knee, [0, -0.4, 0])
  }
  scene.rotation.y = rotation
  scene.updateMatrixWorld(true)
  const vrm = {
    scene,
    meta: { metaVersion: version },
    humanoid: {
      getNormalizedBoneNode: (name: string) => bones.get(name) ?? null,
    },
  } as unknown as VRM
  const safety = new GeneratedBodySafety()
  safety.attach(vrm)
  return { scene, bones, safety }
}
const bone = (bones: Map<string, THREE.Object3D>, name: string) => {
  const found = bones.get(name)
  if (!found) throw new Error(`Missing ${name}`)
  return found
}

function torsoClearance(bones: Map<string, THREE.Object3D>, scene: THREE.Scene): number {
  const center = new THREE.Vector3(0, 1.1475, 0)
  let minimum = Infinity
  const elbow = bone(bones, 'leftLowerArm')
    .getWorldPosition(new THREE.Vector3())
    .applyMatrix4(scene.matrixWorld.clone().invert())
  const wrist = bone(bones, 'leftHand')
    .getWorldPosition(new THREE.Vector3())
    .applyMatrix4(scene.matrixWorld.clone().invert())
  for (let i = 0; i <= 40; i += 1) {
    const point = elbow
      .clone()
      .lerp(wrist, i / 40)
      .sub(center)
    minimum = Math.min(minimum, Math.hypot(point.x / 0.18, point.y / 0.324, point.z / 0.125))
  }
  return minimum
}

describe('generated body anatomical safety', () => {
  it('keeps a MotionBricks arm velocity bounded after hinge and wrist projection across phases', () => {
    const { bones, safety } = fixture()
    safety.apply(Infinity)
    const arm = bone(bones, 'leftUpperArm')
    const lower = bone(bones, 'leftLowerArm')
    const hand = bone(bones, 'leftHand')
    let previous = [arm, lower, hand].map((node) => node.quaternion.clone())
    for (let frame = 0; frame < 240; frame++) {
      arm.quaternion.setFromEuler(new THREE.Euler(-0.3, 0.8, 1.1))
      lower.quaternion.setFromEuler(new THREE.Euler(0.7, frame < 120 ? 2.8 : -2.8, 0.9))
      hand.quaternion.setFromEuler(new THREE.Euler(1.2, -1.2, 1.2))
      safety.apply(1 / 60, 1, true, {
        motionClass: 'gesture',
        sourceProvider: 'motionbricks',
        phase: frame < 80 ? 'prepare' : frame < 160 ? 'stroke' : 'recover',
      })
      for (const [index, node] of [arm, lower, hand].entries())
        expect(previous[index].angleTo(node.quaternion) * 60).toBeLessThanOrEqual(1.501)
      previous = [arm, lower, hand].map((node) => node.quaternion.clone())
      expect(safety.getDebugState().unresolvedArmContacts).toBe(0)
    }
  })
  it('escapes a contact introduced by a moving attachment without freezing the whole chain', () => {
    const { bones, safety } = fixture()
    bone(bones, 'leftUpperArm').rotation.z = 1.15
    bone(bones, 'rightUpperArm').rotation.z = -1.15
    safety.apply()
    expect(safety.getDebugState().unresolvedArmContacts).toBe(0)
    bone(bones, 'leftUpperArm').position.x += 0.2
    safety.setHandTargets(getMotionProfile('surprise_small'), 'prepare')
    const tracked = [...bones].filter(([name]) => /Arm|Hand/u.test(name)).map(([, value]) => value)
    let previous = tracked.map((value) => value.quaternion.clone())
    for (let frame = 0; frame < 180; frame++) {
      safety.apply(1 / 60)
      for (const [index, value] of tracked.entries())
        expect(previous[index].angleTo(value.quaternion)).toBeLessThanOrEqual(0.026)
      previous = tracked.map((value) => value.quaternion.clone())
    }
    expect(safety.getDebugState().unresolvedArmContacts).toBe(0)
    expect(safety.handTargetsReached()).toBe(true)
  })

  it('projects equivalent hinge rotations across pi to the same anatomical boundary', () => {
    const { bones, safety } = fixture()
    const elbow = bone(bones, 'leftLowerArm')
    const before = elbow.quaternion.clone()
    const targets = [Math.PI - 0.01, -Math.PI + 0.01].map((angle) => {
      const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
      safety.constrainTarget(elbow, target)
      return target
    })
    expect(targets[0].angleTo(targets[1])).toBeLessThan(0.001)
    expect(targets[0].angleTo(before)).toBeGreaterThan(2)
    expect(elbow.quaternion.toArray()).toEqual(before.toArray())
  })

  it.each(['0', '1'] as const)(
    'bounds knee hyperextension and sideways swing for VRM%s',
    (version) => {
      const { bones, safety } = fixture(version)
      const knee = bone(bones, 'leftLowerLeg')
      knee.rotation.set(version === '0' ? 1 : -1, 0.8, 1.1)
      safety.apply()
      const ankle = bone(bones, 'leftFoot').position.clone().applyQuaternion(knee.quaternion)
      expect(Math.abs(ankle.x)).toBeLessThan(0.002)
      expect(Math.abs(ankle.z)).toBeLessThan(0.01)
      expect(knee.quaternion.length()).toBeCloseTo(1)
    },
  )

  it('removes sideways elbow bending while retaining axial forearm twist', () => {
    const { bones, safety } = fixture()
    const elbow = bone(bones, 'leftLowerArm')
    elbow.quaternion
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), -1)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5))
    const before = elbow.quaternion.clone()
    safety.apply()
    expect(elbow.quaternion.angleTo(before)).toBeLessThan(1e-6)
    elbow.rotation.z = 1.2
    safety.apply()
    const forearm = bone(bones, 'leftHand').position.clone().applyQuaternion(elbow.quaternion)
    expect(Math.abs(forearm.y)).toBeLessThan(0.001)
  })

  it.each([0, 1.1])('keeps an unobstructed front gesture at scene yaw %s', (yaw) => {
    const { bones, safety } = fixture('0', yaw)
    const arm = bone(bones, 'leftUpperArm'),
      elbow = bone(bones, 'leftLowerArm')
    arm.rotation.y = -0.8
    elbow.rotation.y = -1.8
    const upperBefore = arm.quaternion.clone(),
      lowerBefore = elbow.quaternion.clone()
    safety.apply()
    expect(arm.quaternion.angleTo(upperBefore)).toBeLessThan(1e-6)
    expect(elbow.quaternion.angleTo(lowerBefore)).toBeLessThan(1e-6)
  })

  it.each([
    ['0', 0],
    ['0', 1.1],
    ['1', 0],
    ['1', 1.1],
  ] as const)('moves a forearm out of the torso for VRM%s at scene yaw %s', (version, yaw) => {
    const { bones, scene, safety } = fixture(version, yaw)
    bone(bones, 'leftUpperArm').rotation.z = (version === '0' ? 1 : -1) * Math.PI * 0.75
    scene.updateMatrixWorld(true)
    expect(torsoClearance(bones, scene)).toBeLessThan(1)
    safety.apply()
    scene.updateMatrixWorld(true)
    expect(torsoClearance(bones, scene)).toBeGreaterThanOrEqual(1)
    for (const value of bones.values())
      expect(value.quaternion.toArray().every(Number.isFinite)).toBe(true)
  })

  it('projects tangent arm contact continuously instead of switching to a different pose', () => {
    const positions = [1.754, 1.7545].map((angle) => {
      const { bones, safety } = fixture()
      bone(bones, 'leftUpperArm').rotation.z = angle
      safety.apply()
      return bone(bones, 'leftHand').getWorldPosition(new THREE.Vector3())
    })
    expect(positions[0].distanceTo(positions[1])).toBeLessThan(0.002)
  })

  it('keeps a continuous arm sweep through the torso on one correction branch', () => {
    let previous: THREE.Vector3 | null = null
    let maximumStep = 0
    for (let step = 0; step <= 300; step += 1) {
      const { bones, safety } = fixture()
      bone(bones, 'leftUpperArm').rotation.z = 1 + step * 0.005
      safety.apply()
      const wrist = bone(bones, 'leftHand').getWorldPosition(new THREE.Vector3())
      if (previous) maximumStep = Math.max(maximumStep, previous.distanceTo(wrist))
      previous = wrist
    }
    // Input changes by 2.9mm per sample; the old correction flipped by 97cm.
    expect(maximumStep).toBeLessThan(0.008)
  })

  it('reports bounded per-frame corrections and clears them after reset', () => {
    const { bones, safety } = fixture()
    bone(bones, 'leftUpperArm').rotation.z = Math.PI * 0.75
    bone(bones, 'leftLowerLeg').rotation.x = 1
    safety.apply()
    expect(safety.getDebugState().armCorrections).toBe(1)
    expect(safety.getDebugState().jointCorrections).toBe(2)
    safety.apply()
    expect(safety.getDebugState()).toEqual({
      jointCorrections: 0,
      armCorrections: 0,
      unresolvedArmContacts: 0,
    })
    safety.reset()
    expect(safety.getDebugState()).toEqual({
      jointCorrections: 0,
      armCorrections: 0,
      unresolvedArmContacts: 0,
    })
  })

  it('handles absent optional bones and releases its model references', () => {
    const { safety, bones } = fixture()
    safety.reset()
    const arm = bone(bones, 'leftUpperArm')
    arm.rotation.z = Math.PI * 0.75
    const before = arm.quaternion.clone()
    safety.apply()
    expect(arm.quaternion.toArray()).toEqual(before.toArray())
    safety.attach({
      scene: new THREE.Scene(),
      meta: { metaVersion: '1' },
      humanoid: {
        getNormalizedBoneNode: () => null,
      },
    } as unknown as VRM)
    expect(() => safety.apply()).not.toThrow()
  })
})
