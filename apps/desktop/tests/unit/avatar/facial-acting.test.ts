import { VRMExpression, VRMExpressionManager, VRMExpressionMorphTargetBind } from '@pixiv/three-vrm'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'

import { AvatarFacialRuntime } from '../../../src/renderer/avatar/embodiment/AvatarFacialRuntime'
import { AvatarExpressionMixer } from '../../../src/renderer/avatar/embodiment/facial/AvatarExpressionMixer'
import { BlinkController } from '../../../src/renderer/avatar/embodiment/facial/BlinkController'
import { FacialActingController } from '../../../src/renderer/avatar/embodiment/facial/FacialActingController'
import { inspectFacialRig } from '../../../src/renderer/avatar/embodiment/facial/FacialRigCapabilities'
import { facialActingPresentationSchema } from '../../../src/shared/facial-acting'
import { createMinimalVrm } from '../../support/avatar/minimalVrm'

function rig() {
  const { vrm } = createMinimalVrm()
  const manager = new VRMExpressionManager()
  Object.assign(vrm, { expressionManager: manager })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geometry.morphTargetsRelative = true
  geometry.morphAttributes.position = [0.01, 0.003, 0, 0.002, 0.02, 0.02].map(
    (value) => new Float32BufferAttribute([0, value, 0, 0, 0, 0, 0, 0, 0], 3),
  )
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.morphTargetDictionary = {
    browInnerUp: 0,
    mouthSmileLeft: 1,
    browDownLeft: 2,
    eyeWideLeft: 3,
    eyeBlinkLeft: 4,
    eyeBlinkRight: 5,
  }
  vrm.scene.add(mesh)
  for (const [name, index] of [
    ['blinkLeft', 4],
    ['blinkRight', 5],
  ] as const) {
    const expression = new VRMExpression(name)
    expression.addBind(new VRMExpressionMorphTargetBind({ primitives: [mesh], index, weight: 1 }))
    manager.registerExpression(expression)
  }
  return { vrm, manager, mesh }
}

describe('capability-gated facial acting', () => {
  it('finishes a unilateral wink, respects blink/cooldown and cancels on detach', () => {
    const blink = new BlinkController(undefined, () => 0.5)
    blink.attach()
    expect(blink.requestWink('left')).toBe(true)
    let maximum = 0
    for (let frame = 0; frame < 60; frame++) {
      blink.update(1 / 120)
      const [left, right] = blink.getBilateralWeights()
      maximum = Math.max(maximum, left)
      expect(right).toBe(0)
      expect(blink.requestWink('right')).toBe(false)
    }
    expect(maximum).toBeGreaterThan(0.9)
    for (let frame = 0; frame < 60; frame++) blink.update(1 / 120)
    expect(blink.getBilateralWeights()).toEqual([0, 0])
    blink.detach()
    expect(blink.getBilateralWeights()).toEqual([0, 0])
    blink.attach()
    blink.force()
    expect(blink.requestWink('right')).toBe(false)
    blink.detach()
  })
  it('retains distinct semantic facial profiles instead of collapsing laughter to happy', () => {
    const runtime = new AvatarFacialRuntime()
    runtime.applyEmotion('laugh')
    expect(runtime.getFacialDebugState().currentProfile).toBe('laugh')
    runtime.applyEmotion('chuckle')
    expect(runtime.getFacialDebugState().currentProfile).toBe('chuckle')
    runtime.detach()
  })
  it('mirrors one actual wink without restarting it on repeated emotion updates', () => {
    const { vrm, manager, mesh } = rig()
    const runtime = new AvatarFacialRuntime()
    runtime.attach(vrm)
    runtime.applyEmotion('amused')
    let maximum = 0
    for (let frame = 0; frame < 100; frame++) {
      runtime.applyEmotion('amused')
      runtime.update(1 / 120)
      manager.update()
      const presentation = runtime.getActingPresentation()
      maximum = Math.max(maximum, presentation.blinkLeft)
      expect(presentation.blinkRight).toBe(0)
      expect(mesh.morphTargetInfluences?.[4]).toBeCloseTo(presentation.blinkLeft)
    }
    expect(maximum).toBeGreaterThan(0.9)
    expect(runtime.getActingPresentation().blinkLeft).toBe(0)
    runtime.detach()
  })
  it('distinguishes real unbound morphs, zero-effect names and missing rig channels', () => {
    const { vrm } = rig()
    const { capabilities } = inspectFacialRig(vrm)
    expect(capabilities.browInnerUp.status).toBe('supported')
    expect(capabilities.browInnerUp.maxDeltaMm).toBeCloseTo(10)
    expect(capabilities.browDownLeft.status).toBe('zero-effect')
    expect(capabilities.mouthSmileRight.status).toBe('missing')
    vrm.scene.scale.setScalar(0.01)
    expect(inspectFacialRig(vrm).capabilities.browInnerUp.maxDeltaMm).toBeCloseTo(0.1)
  })

  it('binds actual geometry only through the Mixer and releases its own declarations on detach', () => {
    const { vrm, manager, mesh } = rig()
    const mixer = new AvatarExpressionMixer()
    mixer.attach(vrm)
    mixer.beginFrame(0.02)
    mixer.setFacialActing({ browInnerUp: 0.5, mouthSmileLeft: 0.4, browDownLeft: 0.7 })
    mixer.apply()
    manager.update()
    expect(mesh.morphTargetInfluences?.[0]).toBeCloseTo(0.5)
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(0.4)
    expect(mesh.morphTargetInfluences?.[2]).toBe(0)
    mixer.detach()
    manager.update()
    expect(Object.keys(manager.expressionMap).sort()).toEqual(['blinkLeft', 'blinkRight'])
    expect(mesh.morphTargetInfluences?.[0]).toBe(0)
    mixer.detach()
  })

  it('gives each eyelid independent Blink authority and protects closure from eye/mouth acting', () => {
    const { vrm, manager, mesh } = rig()
    const mixer = new AvatarExpressionMixer()
    mixer.attach(vrm)
    mixer.beginFrame(0.02)
    mixer.setBlink(1)
    mixer.setBilateralBlink(1, 0.4)
    mixer.setMouth({ aa: 0.2 })
    mixer.setMouthClosure(1)
    mixer.setFacialActing({ eyeWideLeft: 0.8, mouthSmileLeft: 0.7, browInnerUp: 0.3 })
    mixer.apply()
    manager.update()
    expect(mesh.morphTargetInfluences?.[4]).toBe(1)
    expect(mesh.morphTargetInfluences?.[5]).toBeCloseTo(0.4)
    expect(mesh.morphTargetInfluences?.[3]).toBe(0)
    expect(mesh.morphTargetInfluences?.[1]).toBe(0)
    expect(mesh.morphTargetInfluences?.[0]).toBeCloseTo(0.3)
    mixer.detach()
  })

  it('consumes already composed acting without suppressing it a second time', () => {
    const { vrm } = rig()
    const mixer = new AvatarExpressionMixer()
    mixer.attach(vrm)
    mixer.beginFrame(0.02)
    mixer.setBlink(0.6)
    mixer.setFacialActing({ eyeWideLeft: 0.2, mouthSmileLeft: 0.25 }, true)
    mixer.apply()
    expect(mixer.getActingPresentation().acting).toEqual({ eyeWideLeft: 0.2, mouthSmileLeft: 0.25 })
    mixer.detach()
  })

  it('attacks and releases reactions smoothly without retaining the preceding expression', () => {
    const actor = new FacialActingController(() => 0.5)
    expect(actor.update(0, 'happy', false)).toEqual({})
    const first = actor.update(0.02, 'happy', false)
    expect(first.mouthSmileLeft).toBeGreaterThan(0)
    expect(first.mouthSmileLeft).toBeLessThan(0.2)
    for (let frame = 0; frame < 100; frame++) actor.update(0.02, 'surprised', false)
    const surprised = actor.update(0.02, 'surprised', false)
    expect(surprised.eyeWideLeft).toBeGreaterThan(0.5)
    expect(surprised.mouthSmileLeft ?? 0).toBeLessThan(0.001)
    for (let frame = 0; frame < 150; frame++) actor.update(0.02, 'neutral', false)
    expect(actor.update(0.02, 'neutral', false).eyeWideLeft ?? 0).toBeLessThan(0.001)
    actor.reset()
    expect(actor.update(0, 'neutral', false)).toEqual({})
  })

  it('rejects extra channels, invalid bilateral weights and malformed presentation values', () => {
    expect(
      facialActingPresentationSchema.safeParse({
        acting: { script: 1 },
        blinkLeft: 0,
        blinkRight: 0,
      }).success,
    ).toBe(false)
    expect(
      facialActingPresentationSchema.safeParse({
        acting: { browInnerUp: NaN },
        blinkLeft: 0,
        blinkRight: 0,
      }).success,
    ).toBe(false)
    expect(
      facialActingPresentationSchema.safeParse({ acting: {}, blinkLeft: 2, blinkRight: 0 }).success,
    ).toBe(false)
  })
})
