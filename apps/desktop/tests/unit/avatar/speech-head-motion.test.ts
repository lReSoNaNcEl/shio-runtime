import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { AvatarFacialRuntime } from '../../../src/renderer/avatar/embodiment/AvatarFacialRuntime'
import { HeadMotionRuntime } from '../../../src/renderer/avatar/embodiment/gaze/HeadMotionRuntime'

describe('speech-driven head motion', () => {
  it('does not carry a nod to a replacement model or trigger it under an attention impulse', () => {
    const head = new THREE.Object3D()
    const vrm = {
      humanoid: { getNormalizedBoneNode: (name: string) => (name === 'head' ? head : null) },
    } as unknown as VRM
    const runtime = new HeadMotionRuntime()
    runtime.attach(vrm)
    runtime.setProfile('speaking')
    runtime.setSpeechEnergy(0.5)
    runtime.update(0.1)
    expect(runtime.getDebugState().activeGenerators).toContain('speakingNod')
    runtime.detach()
    runtime.attach(vrm)
    runtime.update(0.02)
    expect(runtime.getDebugState().activeGenerators).not.toContain('speakingNod')
    runtime.setSpeechEnergy(0.5)
    runtime.triggerAttentionImpulse('user-interruption')
    runtime.update(0.02)
    expect(runtime.getDebugState().activeGenerators).not.toContain('speakingNod')
    runtime.detach()
  })

  it('forwards playback energy only while speaking and clears it on speech end', () => {
    const setEnergy = vi.spyOn(HeadMotionRuntime.prototype, 'setSpeechEnergy')
    try {
      const runtime = new AvatarFacialRuntime()
      runtime.setSpeechEnergy(0.5)
      expect(setEnergy).toHaveBeenLastCalledWith(0)
      runtime.setProceduralMode('speaking')
      expect(setEnergy).toHaveBeenLastCalledWith(0)
      runtime.setSpeechEnergy(0.3)
      expect(setEnergy).toHaveBeenLastCalledWith(0.3)
      runtime.setProceduralMode('idle')
      expect(setEnergy).toHaveBeenLastCalledWith(0)
    } finally {
      setEnergy.mockRestore()
    }
  })

  it('starts bounded nods on audible energy, waits through silence and respects cooldown', () => {
    const bones = new Map([
      ['head', new THREE.Object3D()],
      ['neck', new THREE.Object3D()],
    ])
    const runtime = new HeadMotionRuntime()
    runtime.attach({
      humanoid: { getNormalizedBoneNode: (name: string) => bones.get(name) },
    } as unknown as VRM)
    runtime.setProfile('speaking')
    let wasActive = false
    let starts = 0
    const advance = (seconds: number) => {
      for (let frame = 0; frame < seconds * 50; frame++) {
        runtime.update(0.02)
        const active = runtime.getDebugState().activeGenerators.includes('speakingNod')
        if (active && !wasActive) starts++
        wasActive = active
      }
    }

    runtime.setSpeechEnergy(0)
    advance(4)
    expect(starts).toBe(0)
    runtime.setSpeechEnergy(0.5)
    advance(8)
    expect(starts).toBe(1)
    runtime.setSpeechEnergy(0)
    advance(3)
    expect(starts).toBe(1)
    runtime.setSpeechEnergy(0.5)
    advance(1)
    expect(starts).toBe(2)
    runtime.setProfile('idle')
    runtime.setSpeechEnergy(0)
    advance(5)
    expect(starts).toBe(2)
    runtime.detach()
  })

  it('attributes head authority scaling only while a probe is active', () => {
    const head = new THREE.Object3D()
    const vrm = {
      humanoid: { getNormalizedBoneNode: (name: string) => (name === 'head' ? head : null) },
    } as unknown as VRM
    const runtime = new HeadMotionRuntime()
    const reports: Array<[number, number]> = []
    runtime.setAttenuationProbe({
      active: true,
      report: (_stage, _channel, requested, applied) => reports.push([requested, applied]),
    })
    runtime.attach(vrm)
    runtime.setProfile('speaking')
    runtime.setSpeechEnergy(0.6)
    for (let frame = 0; frame < 20; frame++) runtime.update(0.05)
    const full = reports.filter(([requested]) => requested > 1e-6)
    expect(full.length).toBeGreaterThan(0)
    expect(full.every(([requested, applied]) => applied <= requested + 1e-9)).toBe(true)
    reports.length = 0
    runtime.setAuthorityWeight(0.1)
    for (let frame = 0; frame < 20; frame++) runtime.update(0.05)
    expect(reports.some(([requested, applied]) => applied < requested * 0.5)).toBe(true)
    runtime.detach()
  })

  it('widens attention turns with an open delivery style and restores them when cleared', () => {
    const run = (style: Parameters<HeadMotionRuntime['setDeliveryStyle']>[0]) => {
      const head = new THREE.Object3D()
      const vrm = {
        humanoid: { getNormalizedBoneNode: (name: string) => (name === 'head' ? head : null) },
      } as unknown as VRM
      const runtime = new HeadMotionRuntime()
      runtime.attach(vrm)
      runtime.setProfile('speaking')
      runtime.setSpeechEnergy(0.6)
      runtime.setDeliveryStyle(style)
      let peak = 0
      for (let frame = 0; frame < 600; frame++) {
        runtime.update(0.05)
        peak = Math.max(peak, Math.abs(runtime.getDebugState().yawOffset))
      }
      runtime.detach()
      return peak
    }
    const neutral = {
      openness: 0.5,
      height: 0.5,
      tempo: 0.5,
      sharpness: 0.5,
      asymmetry: 0.5,
      lean: 0,
    }
    expect(run({ ...neutral, openness: 1 })).toBeGreaterThan(run({ ...neutral, openness: 0 }))
    expect(run(neutral)).toBeCloseTo(run(null), 9)
  })
})
