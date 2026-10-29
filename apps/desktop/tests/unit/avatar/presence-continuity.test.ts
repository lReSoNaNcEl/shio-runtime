import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { resolveAvatarMotionAuthority } from '../../../src/renderer/avatar/embodiment/motion/AvatarMotionLayer'
import { BreathController } from '../../../src/renderer/avatar/embodiment/motion/BreathController'
import { ProceduralMotionController } from '../../../src/renderer/avatar/embodiment/motion/ProceduralMotionController'
import { breathProfiles } from '../../../src/renderer/avatar/tuning/motionTuning'

function fixture() {
  const chest = new THREE.Object3D()
  chest.position.y = 0.3
  const vrm = {
    humanoid: { getNormalizedBoneNode: (name: string) => (name === 'chest' ? chest : null) },
  } as unknown as VRM
  const breath = new BreathController(421)
  breath.attach(vrm)
  return { breath, chest }
}

describe('continuous presence composition', () => {
  it('adds bounded speech response, releases it on pause/end and keeps breathing continuous', () => {
    const bones = new Map(['spine', 'chest', 'head'].map((name) => [name, new THREE.Object3D()]))
    const vrm = {
      humanoid: { getNormalizedBoneNode: (name: string) => bones.get(name) },
    } as unknown as VRM
    const motion = new ProceduralMotionController()
    motion.attach(vrm)
    motion.setMode('speaking')
    const tick = () => {
      motion.remove()
      motion.update(1 / 60)
    }
    motion.setSpeechEnergy(1)
    tick()
    const onset = Math.abs(motion.getDebugState().microMotion.speechPitch)
    expect(onset).toBeGreaterThan(0)
    expect(onset).toBeLessThan(0.001)
    for (let frame = 0; frame < 120; frame++) tick()
    expect(Math.abs(motion.getDebugState().microMotion.speechPitch)).toBeCloseTo(0.004, 5)
    motion.setBodyMotionLayer('gesture')
    tick()
    expect(Math.abs(motion.getDebugState().microMotion.speechPitch)).toBeLessThanOrEqual(
      0.004 * 0.24,
    )
    motion.setSpeechEnergy(0)
    for (let frame = 0; frame < 60; frame++) tick()
    expect(Math.abs(motion.getDebugState().microMotion.speechPitch)).toBeLessThan(0.00001)
    motion.setSpeechEnergy(1)
    for (let frame = 0; frame < 60; frame++) tick()
    const phase = motion.getDebugState().breathing.phase
    motion.setMode('idle')
    expect(motion.getDebugState().breathing.phase).toBe(phase)
    for (let frame = 0; frame < 60; frame++) tick()
    expect(Math.abs(motion.getDebugState().microMotion.speechPitch)).toBeLessThan(0.00001)
    motion.setSpeechEnergy(Number.NaN)
    tick()
    expect(Number.isFinite(bones.get('spine')?.rotation.x)).toBe(true)
    motion.detach()
    expect(bones.get('chest')?.position.y).toBeCloseTo(0, 10)
    expect(bones.get('spine')?.rotation.x).toBeCloseTo(0, 10)
  })

  it.each([30, 60, 120])(
    'preserves the breathing envelope through per-frame removal at %i FPS for 60 seconds',
    (fps) => {
      const primary = fixture()
      const reference = fixture()
      let min = Infinity
      let max = -Infinity
      for (let frame = 0; frame < fps * 60; frame++) {
        const mode = (['idle', 'listening', 'thinking', 'speaking'] as const)[
          Math.floor(frame / (fps * 15))
        ]
        primary.breath.setProfile(breathProfiles[mode])
        reference.breath.setProfile(breathProfiles[mode])
        primary.breath.remove()
        primary.breath.remove()
        expect(primary.chest.position.y).toBeCloseTo(0.3, 10)
        primary.breath.update(1 / fps)
        reference.breath.update(1 / fps)
        expect(primary.chest.position.y).toBeCloseTo(reference.chest.position.y, 10)
        min = Math.min(min, primary.breath.getDebugState().offsetY)
        max = Math.max(max, primary.breath.getDebugState().offsetY)
      }
      expect(max - min).toBeGreaterThan(0.004)
      primary.breath.detach()
      primary.breath.detach()
      expect(primary.chest.position.y).toBeCloseTo(0.3, 10)
    },
  )

  it('does not suppress independent head motion just because generated motion owns a body gesture', () => {
    for (const directedGaze of [false, true]) {
      for (const screenGaze of [false, true]) {
        const base = resolveAvatarMotionAuthority({ bodyLayer: 'base', directedGaze, screenGaze })
        for (const bodyLayer of ['gesture', 'reaction'] as const) {
          const active = resolveAvatarMotionAuthority({ bodyLayer, directedGaze, screenGaze })
          expect(active.proceduralHeadWeight).toBe(base.proceduralHeadWeight)
          expect(active.proceduralUpperBodyWeight).toBeLessThan(base.proceduralUpperBodyWeight)
        }
      }
    }
  })
})
