import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { TurnInPlaceMotion } from '../../../src/renderer/avatar/rendering/three/TurnInPlaceMotion'
import { type BodyPresentation, bodyTurnIntentSchema } from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'
import { createMockMotionApi, createMotionLease } from '../../support/avatar/motionFixtures'

describe('actual-rig procedural turn support', () => {
  it('mirrors a full heading revolution while the neural source cursor is held', () => {
    const vrm = greenFoxRig()
    const mirror = new GeneratedBodyPlayback(() => undefined)
    mirror.attach(vrm)
    mirror.setPresentationOnly(true)
    let measured = 0
    const previous = vrm.scene.quaternion.clone()
    for (let quadrant = 0; quadrant <= 4; quadrant++) {
      const heading = (quadrant * Math.PI) / 2
      const pose: BodyPresentation = {
        lease: createMotionLease(),
        profileId: 'turn_in_place',
        frame: 0,
        composedAtMs: quadrant * 100,
        executionId: 'turn-mirror',
        bones: {},
        hipsPosition: [0, 1, 0],
        stage: {
          position: [0, 0, 0],
          orientation: new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
            .toArray(),
          continuousHeading: heading,
          generator: 'procedural',
        },
      }
      mirror.setMirror(pose)
      for (let frame = 0; frame < 6; frame++) {
        mirror.update(1 / 60, () => undefined)
        const delta = vrm.scene.quaternion.clone().multiply(previous.clone().invert())
        measured += 2 * Math.atan2(delta.y, delta.w)
        previous.copy(vrm.scene.quaternion)
      }
    }
    expect(measured).toBeCloseTo(Math.PI * 2, 5)
    expect(vrm.scene.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
    mirror.detach()
  })
  it('returns to neural presence without claiming procedural time as consumed source frames', async () => {
    const api = createMockMotionApi()
    vi.stubGlobal('window', { api: { motion: api } })
    const owner = new GeneratedBodyPlayback(() => undefined)
    owner.attach(greenFoxRig())
    const context = {
      animationId: 'turn_in_place',
      behaviorId: 'debug-preview',
      source: 'debug-preview',
      reason: 'turn regression',
      previousAnimationId: null,
      forceReplay: false,
      motionLayer: 'base' as const,
    }
    try {
      await owner.playProfile('turn_in_place', context)
      for (let frame = 0; frame < 2400 && owner.getLibraryDebug().outcome === null; frame++)
        owner.update(1 / 60, () => undefined)
      expect(owner.getLibraryDebug().outcome).toBe('completed')
      expect(owner.getBodyMotionDebugState().sourceTimeSeconds).toBe(0)
      expect(api.next).not.toHaveBeenCalled()
      await owner.playProfile('presence_poised', { ...context, animationId: 'presence_poised' })
      expect(api.next.mock.calls[0][0].fromFrame).toBe(0)
      owner.detach()
      await owner.settleCancellation()
      owner.attach(greenFoxRig())
      expect(owner.getPresentation()).toBeNull()
      expect(owner.getBodyMotionDebugState().generated.physical).toBeUndefined()
    } finally {
      owner.detach()
      await owner.settleCancellation()
      vi.unstubAllGlobals()
    }
  })
  it.each(['clockwise', 'counterclockwise'] as const)(
    'steps through one %s revolution and verifies contact before completion',
    (direction) => {
      const vrm = greenFoxRig()
      const owner = new GeneratedBodyPlayback(() => undefined)
      owner.attach(vrm)
      const plan = new TurnInPlaceMotion(
        vrm,
        { action: 'turn-in-place', turns: 1, direction, tempo: 1, finishFacing: 'viewer' },
        17,
      )
      let previous = 0,
        released = 0
      for (let frame = 0; frame < 2400 && !plan.outcome; frame++) {
        plan.advance(1 / 60)
        plan.solveAndVerify(true)
        const step = plan.heading - previous
        expect(direction === 'clockwise' ? step : -step).toBeLessThanOrEqual(1e-8)
        expect(Math.abs(step)).toBeLessThan(0.08)
        if (plan.feet.some((foot) => !foot.support)) released++
        previous = plan.heading
      }
      expect(plan.outcome).toBe('completed')
      expect(Math.abs(plan.heading)).toBeCloseTo(Math.PI * 2, 5)
      expect(plan.contactReleases).toBeGreaterThan(2)
      expect(plan.contactReleases).toBeLessThan(24)
      expect(plan.getStatus().maxRootAccelerationMps2).toBeLessThan(8)
      expect(released).toBeGreaterThan(100)
      expect(plan.maxSupportDrift).toBeLessThan(0.003)
      expect(vrm.scene.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.002)
    },
  )
  it('lands the active step on interruption and retains cancelled rather than completed', () => {
    const vrm = greenFoxRig()
    new GeneratedBodyPlayback(() => undefined).attach(vrm)
    const plan = new TurnInPlaceMotion(
      vrm,
      {
        action: 'turn-in-place',
        turns: 1,
        direction: 'clockwise',
        tempo: 1.2,
        finishFacing: 'viewer',
      },
      42,
    )
    for (let frame = 0; frame < 2400 && !plan.outcome; frame++) {
      if (frame === 111) plan.requestStop()
      plan.advance(1 / 60)
      plan.solveAndVerify(true)
    }
    expect(plan.outcome).toBe('cancelled')
    expect(plan.feet.every((foot) => foot.support)).toBe(true)
    expect(Math.abs(plan.heading)).toBeLessThan(Math.PI * 2)
    expect(plan.maxSupportDrift).toBeLessThan(0.003)
    expect(vrm.scene.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.002)
  })
  it('rejects unbounded semantic action parameters before any rig mutation', () => {
    expect(
      bodyTurnIntentSchema.safeParse({
        action: 'turn-in-place',
        turns: 100,
        direction: 'clockwise',
        tempo: 9,
        finishFacing: 'viewer',
      }).success,
    ).toBe(false)
  })
})
