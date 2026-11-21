import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { DanceInPlaceMotion } from '../../../src/renderer/avatar/rendering/three/DanceInPlaceMotion'
import { measurePlantedFeet } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyBindings'
import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import type { GeneratedMotionRequestContext } from '../../../src/renderer/avatar/rendering/three/GeneratedMotionTypes'
import { plantLeg } from '../../../src/renderer/avatar/rendering/three/plantLeg'
import {
  DANCE_HORIZON_FRAMES,
  FLASH_MOTION_FORMAT,
  type MotionChunk,
} from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'
import { createMockMotionApi, createMotionChunk } from '../../support/avatar/motionFixtures'

function source(moving: boolean): MotionChunk {
  const danceFeet: NonNullable<NonNullable<MotionChunk['flashMotion']>['danceFeet']> = Array.from(
    { length: DANCE_HORIZON_FRAMES },
    (_, frame) => {
      const accent = Math.floor(frame / 24)
      const rise = moving ? Math.sin((Math.PI * (frame % 24)) / 24) ** 2 * 0.065 : 0
      return [
        [0.08 + (accent % 2 === 0 ? rise : 0), 0.1 + (accent % 2 === 0 ? rise : 0), 0],
        [-0.08 - (accent % 2 === 1 ? rise : 0), 0.1 + (accent % 2 === 1 ? rise : 0), 0],
      ]
    },
  )
  const chunk = createMotionChunk()
  return {
    ...chunk,
    profileId: 'dance_in_place',
    sourceProvider: 'flashmotion',
    flashMotion: { mode: 't2m', weightsRevision: FLASH_MOTION_FORMAT.weightsRevision, danceFeet },
    rotations: [...chunk.rotations, ...chunk.rotations],
    rootPositions: [...chunk.rootPositions, ...chunk.rootPositions],
    footContacts: [...chunk.footContacts, ...chunk.footContacts],
    plan: { ...chunk.plan, danceStyle: 'smooth', handScoreRevision: 'dance_in_place-hands-v1' },
  }
}

function createStandingRig() {
  const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
  const beds = measurePlantedFeet(vrm, -1)
  const hips = vrm.humanoid.getNormalizedBoneNode('hips')
  if (!hips) throw new Error('Missing hips')
  hips.position.y -= 0.035
  vrm.scene.updateMatrixWorld(true)
  for (const [index, foot] of beds.entries()) {
    foot.target.x = (index ? 1 : -1) * 0.075
    plantLeg(foot.upper, foot.lower, foot.foot, foot.target, foot.orientation, foot.pole)
  }
  return vrm
}

function createDance(moving = true) {
  return new DanceInPlaceMotion(
    createStandingRig(),
    { action: 'dance-in-place', style: 'smooth', tempo: 1 },
    source(moving),
    0,
  )
}

function finish(dance: DanceInPlaceMotion) {
  const supports = new Set<string>()
  for (let frame = 0; frame < 600 && !dance.outcome; frame++) {
    const previous = dance.feet.map((foot) => (foot.support ? foot.target.clone() : null))
    dance.advance(1 / 60)
    dance.solveAndVerify(true)
    supports.add(dance.getStatus().support)
    for (const [index, foot] of dance.feet.entries()) {
      if (!foot.support) continue
      if (previous[index]) expect(foot.target.distanceTo(previous[index])).toBeLessThan(1e-6)
      expect(foot.foot.getWorldPosition(new THREE.Vector3()).distanceTo(foot.target)).toBeLessThan(
        0.003,
      )
    }
  }
  return supports
}

describe('FlashMotion dance support', () => {
  it('retargets source steps and lands with both feet', () => {
    const dance = createDance()
    const standing = dance.feet.map((foot) => foot.target.clone())
    const supports = finish(dance)
    expect(supports).toEqual(new Set(['left', 'right', 'double']))
    expect(dance.getStatus()).toMatchObject({
      generator: 'flashmotion',
      outcome: 'completed',
      support: 'double',
    })
    expect(dance.getStatus().steps).toBeGreaterThanOrEqual(2)
    for (const [index, foot] of dance.feet.entries()) {
      expect(foot.target.distanceTo(standing[index])).toBeLessThan(0.001)
      expect(
        foot.foot.getWorldPosition(new THREE.Vector3()).distanceTo(standing[index]),
      ).toBeLessThan(0.003)
    }
  })

  it('rejects a track without a step and cancels before a foot release', () => {
    expect(() => createDance(false)).toThrow('MOTION_DANCE_SUPPORT_UNREACHED')
    const dance = createDance()
    dance.advance(0.05)
    dance.requestStop()
    finish(dance)
    expect(dance.getStatus()).toMatchObject({ outcome: 'cancelled', steps: 0, support: 'double' })
  })

  it('returns both feet on interruption during a dance step', () => {
    const dance = createDance()
    const standing = dance.feet.map((foot) => foot.target.clone())
    for (let frame = 0; frame < 480 && dance.getStatus().steps < 2; frame++) {
      dance.advance(1 / 60)
      dance.solveAndVerify(true)
    }
    expect(dance.getStatus().steps).toBe(2)
    dance.requestStop('superseded')
    finish(dance)
    expect(dance.getStatus()).toMatchObject({ outcome: 'superseded', steps: 2, support: 'double' })
    for (const [index, foot] of dance.feet.entries())
      expect(foot.target.distanceTo(standing[index])).toBeLessThan(0.001)
  })

  it('hands the entry stance back to the next standing preview', async () => {
    const vrm = createStandingRig()
    const owner = new GeneratedBodyPlayback(() => undefined)
    owner.attach(vrm)
    const standing = measurePlantedFeet(vrm, -1)
    const motion = createMockMotionApi({
      next: async ({ lease, plan, profileId, fromFrame = 0 }) => ({
        ok: true,
        chunk: {
          ...(profileId === 'dance_in_place' ? source(true) : createMotionChunk()),
          ...lease,
          plan,
          profileId,
          fromFrame,
          startFrame: fromFrame,
        },
      }),
    })
    vi.stubGlobal('window', { api: { motion } })
    const context: GeneratedMotionRequestContext = {
      animationId: 'dance_in_place',
      behaviorId: 'debug-preview',
      source: 'debug-preview',
      reason: 'dance support regression',
      previousAnimationId: null,
      forceReplay: false,
      motionLayer: 'base',
      bodyAction: { action: 'dance-in-place', style: 'smooth', tempo: 1 },
    }
    try {
      await owner.playProfile('dance_in_place', context)
      for (let frame = 0; frame < 600 && !owner.getLibraryDebug().outcome; frame++)
        owner.update(1 / 60, () => undefined)
      expect(owner.getLibraryDebug().outcome).toBe('completed')
      expect(owner.getEmbodimentAvailability().availableBodyActions).toContain('dance-in-place')
      await owner.playProfile('presence_poised', {
        ...context,
        animationId: 'presence_poised',
        bodyAction: undefined,
      })
      for (let frame = 0; frame < 120; frame++) owner.update(1 / 60, () => undefined)
      expect(owner.getPresentation()?.profileId).toBe('presence_poised')
      for (const foot of standing)
        expect(
          foot.foot.getWorldPosition(new THREE.Vector3()).distanceTo(foot.target),
        ).toBeLessThan(0.003)
    } finally {
      owner.detach()
      await owner.settleCancellation()
      vi.unstubAllGlobals()
    }
  })

  it('retimes upper-body motion to the actual swing accents without reversing the source', () => {
    const dance = createDance()
    const floor = dance.feet.map((foot) => foot.target.y)
    const peaks: number[] = []
    let previous = 0
    let lift = 0
    let liftedSource = 0
    for (let frame = 0; frame < 1200 && !dance.outcome; frame++) {
      dance.advance(1 / 120)
      dance.solveAndVerify(true)
      const progress = dance.upperBodyProgress
      expect(progress).toBeGreaterThanOrEqual(previous - 1e-7)
      previous = progress
      if (dance.phase === 'recover') continue
      const height = Math.max(...dance.feet.map((foot, index) => foot.target.y - floor[index]))
      if (height > lift) {
        lift = height
        liftedSource = progress * (DANCE_HORIZON_FRAMES - 1)
      } else if (height <= 1e-6 && lift > 0.02) {
        peaks.push(liftedSource % 24)
        lift = 0
      }
    }
    expect(peaks.length).toBeGreaterThanOrEqual(2)
    for (const frame of peaks) expect(frame).toBeCloseTo(12, -1)
    expect(previous).toBe(1)
  })
})
