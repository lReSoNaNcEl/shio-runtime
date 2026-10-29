import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { BODY_BONE_NAMES, MOTION_PROFILES } from '../../../src/shared/motion'

function fixture(missingBone?: string) {
  const scene = new THREE.Scene()
  const bones = new Map<string, THREE.Object3D>()
  for (const name of [...BODY_BONE_NAMES, 'neck', 'head']) {
    if (name === missingBone) continue
    const bone = new THREE.Object3D()
    scene.add(bone)
    bones.set(name, bone)
  }
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach({
    scene,
    meta: { metaVersion: '1' },
    humanoid: { getNormalizedBoneNode: (name: string) => bones.get(name) ?? null },
  } as unknown as VRM)
  return { owner, bones }
}

afterEach(() => vi.unstubAllGlobals())

describe('motion library owner availability', () => {
  it('does not label qualified conversational families unqualified because a manual physical action is draft', () => {
    const { owner } = fixture()
    Reflect.set(owner, 'lease', { modelGeneration: 1 })
    Reflect.set(owner, 'playing', true)
    try {
      expect(owner.getEmbodimentAvailability()).toMatchObject({
        qualification: 'qualified',
        unavailableReasons: [],
        availableBodyActions: [],
      })
      expect(owner.getEmbodimentAvailability().availableSemanticIntents).toContain('greeting')
    } finally {
      Reflect.set(owner, 'lease', null)
      owner.detach()
    }
  })
  it('advertises only qualified intents the conversational selector can execute', () => {
    const states = MOTION_PROFILES.map((profile) => profile.qualification.state)
    const { owner } = fixture()
    try {
      for (const profile of MOTION_PROFILES) profile.qualification.state = 'qualified'
      Reflect.set(owner, 'phase', 'ready')
      Reflect.set(owner, 'lease', { modelGeneration: 1 })
      Reflect.set(owner, 'playing', true)
      const advertised = owner.getEmbodimentAvailability().availableSemanticIntents
      expect(advertised).toContain('greeting')
      expect(advertised).toContain('peace')
      expect(advertised).not.toContain('kiss')
      expect(advertised).not.toContain('stretch')
      Reflect.set(owner, 'phase', 'loading')
      expect(owner.getEmbodimentAvailability().availableSemanticIntents).toEqual(advertised)
      Reflect.set(owner, 'error', 'MOTION_SPATIAL_TARGET_UNREACHED')
      expect(owner.getEmbodimentAvailability().availableSemanticIntents).toEqual([])
      expect(owner.getEmbodimentAvailability().unavailableReasons).toEqual(['motion-unavailable'])
      Reflect.set(owner, 'phase', 'degraded')
      expect(owner.getEmbodimentAvailability().unavailableReasons).toEqual(['motion-unavailable'])
      expect(owner.getEmbodimentAvailability().qualification).toBe('qualified')
    } finally {
      MOTION_PROFILES.forEach((profile, index) => {
        profile.qualification.state = states[index]
      })
      Reflect.set(owner, 'lease', null)
      owner.detach()
    }
  })
  it('requires each gesture workspace anchor while retaining compatible presence profiles', () => {
    for (const [missing, profile] of [
      ['neck', 'peace_single'],
      ['head', 'kiss_air_soft'],
      ['chest', 'thank_heart_hover'],
    ]) {
      const { owner } = fixture(missing)
      expect(owner.getLibraryDebug().profiles[profile]).toEqual({
        available: false,
        reason: 'rig-unsupported',
      })
      expect(owner.getLibraryDebug().profiles.presence_poised.available).toBe(true)
      owner.detach()
    }
  })
  it('reports model readiness without inventing a running execution', () => {
    const owner = new GeneratedBodyPlayback(() => undefined)
    const debug = owner.getLibraryDebug()
    expect(Object.keys(debug.profiles)).toHaveLength(MOTION_PROFILES.length)
    expect(
      Object.values(debug.profiles).every(
        (entry) => !entry.available && entry.reason === 'model-not-ready',
      ),
    ).toBe(true)
    expect(debug.runningProfileId).toBeNull()
    expect(debug.phase).toBeNull()
    expect(debug.executionId).toBeNull()
  })

  it('rejects incomplete supporting-hand chains for every score and tolerates absent optional appendages', () => {
    const incomplete = fixture('leftLittleDistal')
    expect(
      Object.values(incomplete.owner.getLibraryDebug().profiles).every(
        (entry) => !entry.available && entry.reason === 'rig-unsupported',
      ),
    ).toBe(true)
    incomplete.owner.detach()

    const incompleteLeg = fixture('rightLowerLeg')
    expect(incompleteLeg.owner.getLibraryDebug().profiles.peace_single).toEqual({
      available: false,
      reason: 'rig-unsupported',
    })
    incompleteLeg.owner.detach()

    const bodyOnly = fixture()
    expect(bodyOnly.owner.getLibraryDebug().profiles.peace_single.available).toBe(true)
    expect(bodyOnly.owner.getLibraryDebug().profiles.fox_paw_single.available).toBe(true)
    bodyOnly.owner.detach()
  })

  it('keeps draft gestures inspectable while rejecting conversational execution before inference', async () => {
    const start = vi.fn()
    vi.stubGlobal('window', { api: { motion: { start } } })
    const { owner, bones } = fixture()
    const profile = MOTION_PROFILES.find((entry) => entry.id === 'agree_soft')
    if (!profile) throw new Error('Missing agreement profile')
    const previousState = profile.qualification.state
    profile.qualification.state = 'draft'
    try {
      const before = bones.get('rightHand')?.quaternion.clone()
      expect(owner.getLibraryDebug().profiles.agree_soft.available).toBe(true)
      expect(owner.getEmbodimentAvailability().qualification).toBe('draft')
      expect(owner.getEmbodimentAvailability().availableSemanticIntents).toEqual([])
      await expect(
        owner.playProfile('agree_soft', {
          animationId: 'agree_soft',
          behaviorId: 'neutral',
          source: 'character-state',
          reason: 'typed agreement',
          previousAnimationId: null,
          forceReplay: false,
          motionLayer: 'gesture',
        }),
      ).rejects.toThrow('MOTION_qualification-required')
      expect(start).not.toHaveBeenCalled()
      expect(bones.get('rightHand')?.quaternion.toArray()).toEqual(before?.toArray())
      expect(owner.getLibraryDebug().executionId).toBeNull()
    } finally {
      profile.qualification.state = previousState
      owner.detach()
      await owner.settleCancellation()
    }
  })
})
