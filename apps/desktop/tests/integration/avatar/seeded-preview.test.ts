import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AvatarAnimationController } from '../../../src/renderer/avatar/AvatarAnimationController'
import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import { AvatarPlaybackCoordinator } from '../../../src/renderer/avatar/AvatarPlaybackCoordinator'
import { MotionPhaseExecution } from '../../../src/renderer/avatar/MotionPhaseExecution'
import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import type { VrmModel } from '../../../src/renderer/avatar/rendering/three/VrmModel'
import {
  getMotionProfile,
  HAND_BONE_NAMES,
  type MotionApi,
  type MotionChunk,
  type MotionLease,
  type MotionReply,
} from '../../../src/shared/motion'
import { createMinimalVrm } from '../../support/avatar/minimalVrm'
import { createMotionChunk, createMotionLease } from '../../support/avatar/motionFixtures'

const owners: GeneratedBodyPlayback[] = []

function bodyFixture() {
  const { bones, vrm } = createMinimalVrm()
  const owner = new GeneratedBodyPlayback(() => undefined)
  owners.push(owner)
  owner.attach(vrm)
  return { owner, bones }
}

async function flush() {
  for (let round = 0; round < 12; round++) await Promise.resolve()
}

afterEach(async () => {
  for (const owner of owners.splice(0)) {
    owner.detach()
    await owner.settleCancellation()
  }
  vi.unstubAllGlobals()
})

describe('fixed Preview variation seeds and physical recovery', () => {
  it('settles a completed native act into bounded standing variation without accumulating or adopting a failed act', () => {
    const { owner, bones } = bodyFixture()
    const profile = getMotionProfile('explain_one_palm')
    if (!profile) throw new Error('Missing profile')
    const execution = new MotionPhaseExecution('rest-variation', profile)
    execution.phase = 'recover'
    Reflect.set(owner, 'execution', execution)
    Reflect.set(owner, 'appliedSourceProvider', 'motionbricks')
    const lower = bones.get('rightLowerArm')
    if (!lower) throw new Error('Missing arm')
    lower.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.5)
    const bindings = Reflect.get(owner, 'bindings') as Array<{
      name: string
      safe: THREE.Quaternion
      calibratedSafe: THREE.Quaternion
    }>
    const binding = bindings.find((entry) => entry.name === 'rightLowerArm')
    if (!binding) throw new Error('Missing binding')
    Reflect.get(owner, 'invalidatePhase').call(owner)
    expect(binding.safe.angleTo(binding.calibratedSafe)).toBeGreaterThan(0.05)
    expect(binding.safe.angleTo(binding.calibratedSafe)).toBeLessThanOrEqual(0.181)
    const admitted = binding.safe.clone()
    execution.requestFailureRecovery()
    lower.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 2)
    Reflect.get(owner, 'invalidatePhase').call(owner)
    expect(binding.safe.angleTo(admitted)).toBeLessThan(1e-7)
  })
  it('starts native-hand recovery from the actual composed fingers instead of the hidden procedural target', () => {
    const { vrm, bones } = createMinimalVrm({ extraBones: [...HAND_BONE_NAMES] })
    const owner = new GeneratedBodyPlayback(() => undefined)
    owners.push(owner)
    owner.attach(vrm)
    const profile = getMotionProfile('peace_single')
    if (!profile) throw new Error('Missing profile')
    const execution = new MotionPhaseExecution('native-hand-recovery', profile)
    execution.phase = 'recover'
    Reflect.set(owner, 'execution', execution)
    Reflect.set(owner, 'appliedSourceProvider', 'motionbricks')
    Reflect.set(owner, 'somaHands', {})
    const finger = bones.get('rightIndexProximal')
    if (!finger) throw new Error('Missing finger')
    finger.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.9)
    const composed = finger.quaternion.clone()
    Reflect.get(owner, 'invalidatePhase').call(owner)
    const hand = Reflect.get(owner, 'handPose').sampleScore(profile.id, execution.id, 'recover', 0)
    expect(hand.get('rightIndexProximal').angleTo(composed)).toBeLessThan(1e-7)
  })
  it('forwards an explicit seed through the shared Preview coordinator to the model port', async () => {
    const request = vi.fn(async () => undefined)
    const model = {
      isLoaded: () => true,
      isAnimationPlaying: () => true,
      requestGeneratedMotion: request,
      getBodyMotionDebugState: () => ({ transitionRemaining: 0 }),
      setBodyMotionLayer: vi.fn(),
    } as unknown as VrmModel
    const animations = new AvatarAnimationController(model)
    const coordinator = new AvatarPlaybackCoordinator(animations, model)
    const controller = Object.assign(Object.create(AvatarController.prototype), {
      playback: coordinator,
      frame: 1,
      lastEffect: { mode: 'idle' },
    }) as AvatarController
    controller.previewVariation('peace_single', 0)
    await animations.waitForLatestPlaybackRequest(100)
    expect(request).toHaveBeenCalledWith(
      'peace_single',
      expect.objectContaining({ seed: 0, source: 'debug-preview', forceReplay: true }),
    )
  })

  it('passes fixed seeds to initial Main start and existing-lease reroll', async () => {
    let lease: MotionLease = createMotionLease({ sessionId: 'fixed-seed', seed: 0 })
    const start = vi.fn(async (input: Parameters<MotionApi['start']>[0]) => {
      lease = { ...lease, avatarGeneration: input.avatarGeneration, seed: input.seed ?? 9 }
      return { ok: true as const, lease }
    })
    const reroll = vi.fn(async (input: Parameters<MotionApi['reroll']>[0]) => {
      lease = { ...input.lease, epoch: input.lease.epoch + 1, seed: input.seed ?? 9 }
      return { ok: true as const, lease }
    })
    const next = vi.fn(async (input: Parameters<MotionApi['next']>[0]): Promise<MotionReply> => {
      const fromFrame = input.fromFrame ?? 0
      const chunk: MotionChunk = createMotionChunk({
        ...input.lease,
        plan: input.plan,
        id: fromFrame + 1,
        reset: fromFrame === 0,
        fromFrame,
        startFrame: fromFrame,
        profileId: input.profileId,
        inferenceMs: 10,
      })
      return { ok: true, chunk }
    })
    vi.stubGlobal('window', {
      api: { motion: { start, reroll, next, stop: vi.fn(async () => ({ ok: true })) } },
    })
    const { owner } = bodyFixture()
    const context = {
      animationId: 'presence_poised',
      behaviorId: 'idle',
      source: 'debug-preview',
      reason: 'fixed-seed qualification',
      previousAnimationId: null,
      forceReplay: true,
      motionLayer: 'base' as const,
    }
    await owner.playProfile('presence_poised', { ...context, seed: 0 })
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ seed: 0 }))
    const variation = owner.playProfile('presence_poised', { ...context, seed: 271 })
    for (let frame = 0; frame < 100; frame++) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    await variation
    expect(reroll).toHaveBeenCalledWith(expect.objectContaining({ seed: 271 }))
    expect(owner.getBodyMotionDebugState().generated?.seed).toBe(271)
    owner.detach()
    await owner.settleCancellation()
  })

  it('times out a recovery whose final safety composition prevents the wrist exit', () => {
    const { owner, bones } = bodyFixture()
    const profile = getMotionProfile('agree_soft')
    if (!profile) throw new Error('Missing fixture profile')
    const execution = new MotionPhaseExecution('recovery-fixture', profile)
    execution.phase = 'recover'
    execution.ready = true
    Reflect.set(owner, 'execution', execution)
    Reflect.set(owner, 'localRecovery', true)
    Reflect.set(owner, 'playing', true)
    vi.spyOn(owner, 'validateFinalComposition').mockImplementation(() => {
      bones.get('rightHand')?.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5)
    })
    const ticks = Math.ceil(execution.budget.maxMs / 50)
    for (let frame = 0; frame < ticks - 1; frame++) owner.update(0.05, () => undefined)
    expect(owner.getLibraryDebug().outcome).toBeNull()
    owner.update(0.05, () => undefined)
    expect(owner.getLibraryDebug().outcome).toBe('timed-out')
    expect(owner.getBodyMotionDebugState().generated?.error).toBe(
      'MOTION_RECOVERY_TARGET_UNREACHED',
    )
    owner.detach()
  })
})
