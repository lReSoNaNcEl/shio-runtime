import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BreathController } from '../../../src/renderer/avatar/embodiment/motion/BreathController'
import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { bodyPresentationSchema } from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'
import { createMockMotionApi } from '../../support/avatar/motionFixtures'

const context = {
  animationId: 'presence_poised',
  behaviorId: 'idle',
  source: 'character-state',
  reason: 'live failure recovery',
  previousAnimationId: null,
  forceReplay: false,
  motionLayer: 'base' as const,
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ordinary conversation body liveness', () => {
  it('allows a fresh automatic presence after bounded failure backoff and settled cleanup', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const api = createMockMotionApi()
    api.next.mockResolvedValueOnce({ ok: false, error: 'ARDY_INFERENCE_FAILED' })
    vi.stubGlobal('window', { api: { motion: api } })
    const body = new GeneratedBodyPlayback(() => undefined)
    body.attach(greenFoxRig())
    try {
      await expect(body.playProfile('presence_poised', context)).rejects.toThrow(
        'ARDY_INFERENCE_FAILED',
      )
      await body.settleCancellation()
      await expect(body.playProfile('presence_poised', context)).rejects.toThrow(
        'generator-unavailable',
      )
      now += 2001
      await body.playProfile('presence_poised', context)
      expect(api.start).toHaveBeenCalledTimes(2)
      body.update(1 / 60, () => undefined)
      expect(body.getPresentation()?.lease).not.toBeNull()
      expect(body.getBodyMotionDebugState().generated.error).toBeNull()
    } finally {
      body.detach()
      await body.settleCancellation()
    }
  })

  it('keeps semantic support available while the same healthy lease changes physical phase', async () => {
    const api = createMockMotionApi()
    vi.stubGlobal('window', { api: { motion: api } })
    const body = new GeneratedBodyPlayback(() => undefined)
    body.attach(greenFoxRig())
    try {
      await body.playProfile('presence_poised', context)
      body.update(1 / 60, () => undefined)
      const before = body.getEmbodimentAvailability().availableSemanticIntents
      expect(before).toContain('explain')
      body.releaseSpeechPreparation('presence_poised')
      expect(body.getEmbodimentAvailability().availableSemanticIntents).toEqual(before)
    } finally {
      body.detach()
      await body.settleCancellation()
    }
  })

  it('starts speech preparation from presence and supersedes queued thinking before its accent expires', async () => {
    const api = createMockMotionApi()
    vi.stubGlobal('window', { api: { motion: api } })
    const body = new GeneratedBodyPlayback(() => undefined)
    body.attach(greenFoxRig())
    try {
      await body.playProfile('presence_poised', context)
      body.update(1 / 60, () => undefined)
      const thinking = body
        .playProfile('presence_thinking', { ...context, animationId: 'presence_thinking' })
        .catch((error: Error) => error.message)
      const gesture = body.playProfile('explain_one_palm', {
        ...context,
        animationId: 'explain_one_palm',
        speechBound: true,
        motionLayer: 'gesture',
      })
      expect(body.getLibraryDebug().runningProfileId).toBe('explain_one_palm')
      expect(body.getLibraryDebug().phase).toBe('prepare')
      expect(await thinking).toBe('ARDY_PROFILE_SUPERSEDED')
      for (let frame = 0; frame < 8; frame++) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        body.update(1 / 60, () => undefined)
      }
      await gesture
      expect(body.getLibraryDebug().executionId).not.toBeNull()
    } finally {
      body.detach()
      await body.settleCancellation()
    }
  })

  it('projects breathing to Overlay during warmup/failure without an inference lease or a second generator', () => {
    const primaryVrm = greenFoxRig(),
      mirrorVrm = greenFoxRig()
    const primary = new GeneratedBodyPlayback(() => undefined),
      mirror = new GeneratedBodyPlayback(() => undefined)
    primary.attach(primaryVrm)
    mirror.attach(mirrorVrm)
    mirror.setPresentationOnly(true)
    const breath = new BreathController(421)
    breath.attach(primaryVrm)
    let minimum = Infinity,
      maximum = -Infinity
    for (let frame = 0; frame < 600; frame++) {
      breath.remove()
      primary.update(1 / 60, () => breath.update(1 / 60))
      const pose = primary.getPresentation()
      expect(bodyPresentationSchema.safeParse(pose).success).toBe(true)
      expect(pose?.lease).toBeNull()
      expect(pose?.compositionSource).toBe('local')
      expect(pose?.executionId).toBeUndefined()
      mirror.setMirror(pose)
      mirror.update(1 / 30, () => undefined)
      const chest = mirrorVrm.humanoid.getNormalizedBoneNode('chest')
      if (!chest) throw new Error('Missing fixture chest')
      const y = chest.position.y
      minimum = Math.min(minimum, y)
      maximum = Math.max(maximum, y)
      expect(Math.abs(y - (pose?.chestPosition?.[1] ?? y))).toBeLessThan(0.0001)
    }
    expect(maximum - minimum).toBeGreaterThan(0.002)
    const pose = primary.getPresentation()
    expect(
      bodyPresentationSchema.safeParse({
        ...pose,
        executionId: 'fake-generated-success',
        outcome: 'completed',
      }).success,
    ).toBe(false)
    expect(new THREE.Vector3().fromArray(pose?.hipsPosition ?? [0, 0, 0]).length()).toBeGreaterThan(
      0,
    )
    breath.detach()
    primary.detach()
    mirror.detach()
  })
})
