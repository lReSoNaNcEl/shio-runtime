import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { HeadMotionRuntime } from '../../../src/renderer/avatar/embodiment/gaze/HeadMotionRuntime'
import { PostureShiftController } from '../../../src/renderer/avatar/embodiment/motion/PostureShiftController'
import { headMotionTuning } from '../../../src/renderer/avatar/tuning/motionTuning'
import { bodyPresentationSchema } from '../../../src/shared/motion'

function rig(names: string[]) {
  const bones = new Map(names.map((name) => [name, new THREE.Object3D()]))
  const vrm = {
    humanoid: { getNormalizedBoneNode: (name: string) => bones.get(name) ?? null },
  } as unknown as VRM
  return { bones, vrm }
}

describe('attention shifts and upper-body posture', () => {
  it('turns the head into held, bounded attention shifts and hands a share to the torso', () => {
    const { bones, vrm } = rig(['head', 'neck'])
    const runtime = new HeadMotionRuntime()
    runtime.attach(vrm)
    runtime.setProfile('speaking')
    runtime.setSpeechEnergy(0.4)
    // Directed gaze keeps full attention shifts.
    runtime.setAuthorityWeight(0.32)
    let maxYaw = 0
    let maxTorsoYaw = 0
    let maxStep = 0
    let previous = 0
    for (let frame = 0; frame < 60 * 20; frame++) {
      runtime.update(1 / 60)
      const total = runtime.getDebugState().yawOffset
      maxYaw = Math.max(maxYaw, Math.abs(total))
      maxTorsoYaw = Math.max(maxTorsoYaw, Math.abs(runtime.getTorsoPose().yaw))
      maxStep = Math.max(maxStep, Math.abs(total - previous))
      previous = total
    }
    // A visible conversational turn, never beyond the configured envelope.
    expect(maxYaw).toBeGreaterThan(0.08)
    expect(maxYaw).toBeLessThanOrEqual(headMotionTuning.yawLimit + 1e-9)
    expect(maxTorsoYaw).toBeGreaterThan(0.02)
    // Spring-eased: no single-frame snap.
    expect(maxStep).toBeLessThan(0.02)
    const head = bones.get('head')
    expect(Math.abs(head?.rotation.y ?? 0)).toBeGreaterThan(0)
    runtime.remove()
    expect(Math.abs(head?.rotation.y ?? 0)).toBeLessThan(1e-9)
    runtime.detach()
  })

  it('turns attention toward the visibly acting hand', () => {
    const { bones, vrm } = rig([
      'head',
      'neck',
      'hips',
      'leftUpperArm',
      'rightUpperArm',
      'leftHand',
      'rightHand',
    ])
    // VRM0-style facing: forward is -z, the character's left is -x.
    bones.get('hips')?.position.set(0, 1, 0)
    bones.get('leftUpperArm')?.position.set(-0.18, 1.4, 0)
    bones.get('rightUpperArm')?.position.set(0.18, 1.4, 0)
    bones.get('leftHand')?.position.set(-0.3, 0.9, 0)
    // Right hand raised in front of the chest: an acting right hand.
    bones.get('rightHand')?.position.set(0.25, 1.25, -0.3)
    const runtime = new HeadMotionRuntime()
    runtime.attach(vrm)
    runtime.setProfile('speaking')
    runtime.setSpeechEnergy(0.4)
    runtime.setAuthorityWeight(0.32)
    let rightward = 0
    let leftward = 0
    for (let frame = 0; frame < 60 * 40; frame++) {
      runtime.update(1 / 60)
      const yaw = runtime.getDebugState().yawOffset
      // Positive yaw turns toward the character's left.
      if (yaw < -0.05) rightward++
      if (yaw > 0.05) leftward++
    }
    expect(rightward).toBeGreaterThan(leftward * 2)
    runtime.detach()
  })

  it('never writes head bones or torso share in Overlay presentation', () => {
    const { bones, vrm } = rig(['head', 'neck'])
    const runtime = new HeadMotionRuntime()
    runtime.attach(vrm)
    runtime.setPresentationOnly(true)
    runtime.setProfile('speaking')
    runtime.setSpeechEnergy(0.5)
    for (let frame = 0; frame < 600; frame++) runtime.update(1 / 60)
    expect(bones.get('head')?.quaternion.angleTo(new THREE.Quaternion())).toBe(0)
    expect(bones.get('neck')?.quaternion.angleTo(new THREE.Quaternion())).toBe(0)
    expect(runtime.getTorsoPose()).toEqual({ yaw: 0, pitch: 0, roll: 0 })
    runtime.detach()
  })

  it('carries the torso share, shifts weight within bounds and removes it exactly', () => {
    const { bones, vrm } = rig(['hips', 'spine', 'chest'])
    const posture = new PostureShiftController()
    posture.attach(vrm)
    posture.setMode('speaking')
    posture.setSpeechEnergy(0.5)
    posture.setOrientation({ yaw: 0.1, pitch: 0, roll: 0.02 })
    let maxHips = 0
    for (let frame = 0; frame < 60 * 30; frame++) {
      posture.remove()
      posture.update(1 / 60)
      maxHips = Math.max(maxHips, Math.abs(bones.get('hips')?.rotation.z ?? 0))
    }
    const state = posture.getDebugState()
    expect(state.torsoYaw).toBeCloseTo(0.1, 2)
    expect(maxHips).toBeGreaterThan(0.01)
    expect(maxHips).toBeLessThan(0.07)
    // Engaged speech leans forward slightly.
    expect(bones.get('spine')?.rotation.x ?? 0).toBeLessThan(0)
    posture.remove()
    for (const name of ['hips', 'spine', 'chest'])
      expect(bones.get(name)?.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9)
    posture.detach()
  })

  it('carries the composed head and neck to Overlay through the typed presentation', () => {
    const presentation = {
      lease: null,
      compositionSource: 'local',
      localGeneration: 1,
      profileId: 'presence_poised',
      frame: 0,
      bones: {},
      headBones: { neck: [0, 0.05, 0, 0.9987], head: [0.02, 0.1, 0, 0.9948] },
      hipsPosition: [0, 0.95, 0],
    }
    expect(bodyPresentationSchema.safeParse(presentation).success).toBe(true)
    expect(
      bodyPresentationSchema.safeParse({ ...presentation, headBones: { jaw: [0, 0, 0, 1] } })
        .success,
    ).toBe(false)
  })
})
