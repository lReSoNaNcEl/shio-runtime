import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AvatarAnimationController } from '../../../src/renderer/avatar/AvatarAnimationController'
import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import { AvatarPlaybackCoordinator } from '../../../src/renderer/avatar/AvatarPlaybackCoordinator'
import { MotionPhaseExecution } from '../../../src/renderer/avatar/MotionPhaseExecution'
import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import type { VrmModel } from '../../../src/renderer/avatar/rendering/three/VrmModel'
import {
  BODY_BONE_NAMES,
  getMotionProfile,
  type MotionApi,
  type MotionChunk,
  type MotionLease,
  type MotionReply,
} from '../../../src/shared/motion'

function bodyFixture() {
  const scene = new THREE.Scene()
  const bones = new Map<string, THREE.Object3D>()
  for (const name of BODY_BONE_NAMES) {
    const bone = new THREE.Object3D()
    scene.add(bone)
    bones.set(name, bone)
  }
  bones.get('hips')?.position.set(0, 0.9887084839474641, 0)
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach({
    scene,
    meta: { metaVersion: '1' },
    humanoid: { getNormalizedBoneNode: (name: string) => bones.get(name) ?? null },
  } as unknown as VRM)
  return { owner, bones }
}

async function flush() {
  for (let round = 0; round < 12; round++) await Promise.resolve()
}

afterEach(() => vi.unstubAllGlobals())

describe('fixed Preview variation seeds and physical recovery', () => {
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
    let lease: MotionLease = {
      sessionId: 'fixed-seed',
      epoch: 1,
      modelGeneration: 1,
      avatarGeneration: 1,
      seed: 0,
    }
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
      const chunk: MotionChunk = {
        ...input.lease,
        protocolVersion: 2,
        plan: input.plan,
        type: 'motion',
        id: fromFrame + 1,
        reset: fromFrame === 0,
        fromFrame,
        startFrame: fromFrame,
        profileId: input.profileId,
        skeleton: 'soma30-standard-tpose-v1',
        fps: 30,
        rotations: Array.from({ length: 60 }, () => Array.from({ length: 30 }, () => [0, 0, 0, 1])),
        rootPositions: Array.from({ length: 60 }, () => [0, 0.9887084839474641, 0]),
        footContacts: Array.from({ length: 60 }, () => ({
          leftHeel: 1,
          leftToe: 1,
          rightHeel: 1,
          rightToe: 1,
        })),
        inferenceMs: 10,
      }
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
    expect(owner.getBodyMotionDebugState().generated?.error).toBe('ARDY_RECOVERY_TARGET_UNREACHED')
    owner.detach()
  })
})
