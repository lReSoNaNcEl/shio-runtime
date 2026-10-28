import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { GeneratedBodySafety } from '../../../src/renderer/avatar/rendering/three/GeneratedBodySafety'
import type { GeneratedMotionRequestContext } from '../../../src/renderer/avatar/rendering/three/GeneratedMotionTypes'
import {
  bodyPresentationSchema,
  getMotionProfile,
  type MotionChunk,
  type MotionPlanIdentity,
  motionChunkSchema,
} from '../../../src/shared/motion'
import { createMinimalVrm } from '../../support/avatar/minimalVrm'
import { createMotionChunk, createMotionLease } from '../../support/avatar/motionFixtures'
import { createDeferred, type Deferred } from '../../support/Deferred'

const lease = createMotionLease()
const context: GeneratedMotionRequestContext = {
  animationId: 'presence_poised',
  blendDuration: 0.3,
  behaviorId: 'idle',
  source: 'debug-preview',
  reason: 'qualification',
  previousAnimationId: null,
  forceReplay: false,
  motionLayer: 'base',
}
function chunk(startFrame = 0): MotionChunk {
  return createMotionChunk({ ...lease, reset: startFrame === 0, fromFrame: startFrame, startFrame })
}
const owners: GeneratedBodyPlayback[] = []
const pendingHorizons: Array<{
  deferred: Deferred<{ ok: boolean; chunk: MotionChunk }>
  chunk: MotionChunk
}> = []

function fixture(metaVersion = '1', sceneYaw = 0, hierarchy = false) {
  const { bones, vrm } = createMinimalVrm({
    metaVersion,
    sceneYaw,
    extraBones: ['head', 'neck', 'leftEye', 'jaw'],
  })
  if (hierarchy) {
    const connect = (name: string, parent: string, position: [number, number, number]) => {
      const bone = bones.get(name)
      if (!bone) throw new Error(name)
      bones.get(parent)?.add(bone)
      bone.position.fromArray(position)
    }
    connect('spine', 'hips', [0, 0.15, 0])
    connect('chest', 'spine', [0, 0.17, 0])
    connect('upperChest', 'chest', [0, 0.08, 0])
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? 1 : -1
      connect(`${side}Shoulder`, 'upperChest', [sign * 0.08, 0.03, 0])
      connect(`${side}UpperArm`, `${side}Shoulder`, [sign * 0.12, 0, 0])
      connect(`${side}LowerArm`, `${side}UpperArm`, [sign * 0.27, 0, 0])
      connect(`${side}Hand`, `${side}LowerArm`, [sign * 0.25, 0, 0])
      connect(`${side}UpperLeg`, 'hips', [sign * 0.1, 0, 0])
      connect(`${side}LowerLeg`, `${side}UpperLeg`, [0, -0.44, 0])
      connect(`${side}Foot`, `${side}LowerLeg`, [0, -0.44, 0])
    }
  }
  const next = vi.fn(
    async ({
      fromFrame,
      profileId,
      lease: requestedLease,
    }: {
      fromFrame: number
      profileId: string
      lease: typeof lease
    }) => ({
      ok: true,
      chunk: { ...chunk(fromFrame), profileId, seed: requestedLease.seed },
    }),
  )
  const stop = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('window', {
    api: {
      motion: {
        start: async () => ({ ok: true, lease }),
        next: async (input: {
          fromFrame: number
          profileId: string
          lease: typeof lease
          plan: MotionPlanIdentity
        }) => {
          const result = await next(input)
          return { ...result, chunk: { ...result.chunk, plan: input.plan } }
        },
        stop,
      },
    },
  })
  const owner = new GeneratedBodyPlayback(() => undefined)
  owners.push(owner)
  owner.attach(vrm)
  return { owner, bones, next, stop }
}
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
async function tick(owner: GeneratedBodyPlayback, count = 1) {
  for (let i = 0; i < count; i++) {
    owner.update(0.05, () => undefined)
    await flush()
  }
}

afterEach(async () => {
  for (const owner of owners.splice(0)) {
    owner.detach()
    await owner.settleCancellation()
  }
  const pending = pendingHorizons.splice(0)
  for (const horizon of pending) horizon.deferred.resolve({ ok: true, chunk: horizon.chunk })
  await Promise.all(pending.map(({ deferred }) => deferred.promise))
  await flush()
  vi.unstubAllGlobals()
})
describe('generated-motion diagnostic ownership', () => {
  it('reports the applied profile while a replacement is preparing', async () => {
    const { owner } = fixture()
    expect(owner.getBodyMotionDebugState().appliedPose).toBeNull()
    await owner.playProfile('presence_poised', context)
    await tick(owner)
    const applied = owner.getBodyMotionDebugState().appliedPose
    expect(applied?.profileId).toBe('presence_poised')
    const replacing = owner
      .playProfile('presence_warm', { ...context, animationId: 'presence_warm' })
      .catch(() => undefined)
    expect(owner.getBodyMotionDebugState().appliedPose).toEqual(applied)
    const debug = owner.getBodyMotionDebugState()
    expect(debug.executionsStarted).toBe(1)
    expect(debug.poseOwnerCount).toBe(1)
    expect(debug.sourceTimeSeconds).toBeGreaterThan(0)
    expect(JSON.stringify(debug)).not.toMatch(
      /currentClip|clipCache|lastLoadFile|restartCount|ownershipGapCount|bones|rotations/,
    )
    owner.detach()
    await replacing
    await owner.settleCancellation()
    expect(owner.getBodyMotionDebugState().appliedPose).toBeNull()
    expect(owner.getBodyMotionDebugState().poseOwnerCount).toBe(0)
  })

  it('projects the exact primary presentation in Overlay without starting inference', async () => {
    const { owner } = fixture()
    const start = vi.spyOn(window.api.motion, 'start')
    owner.setPresentationOnly(true)
    owner.setMirror({
      lease,
      profileId: 'agree_soft',
      executionId: 'primary-42',
      phaseId: 'recover',
      frame: 80,
      outcome: null,
      bones: {},
      hipsPosition: [0, 0.95, 0],
    })
    owner.update(1 / 60, () => undefined)
    expect(owner.getBodyMotionDebugState()).toMatchObject({
      presentationMode: 'mirror',
      activeExecutionCount: 0,
      poseOwnerCount: 1,
      executionsStarted: 0,
      appliedPose: {
        profileId: 'agree_soft',
        executionId: 'primary-42',
        phaseId: 'recover',
        sourceFrame: 80,
        outcome: null,
      },
      motionExecution: {
        executionId: 'primary-42',
        phase: 'recover',
        runningProfileId: 'agree_soft',
      },
    })
    expect(start).not.toHaveBeenCalled()
    owner.setMirror(null)
    expect(owner.getBodyMotionDebugState().appliedPose).toBeNull()
    owner.detach()
    await owner.settleCancellation()
  })
})
describe('generated body timeline', () => {
  it('keeps generated joint output identical across Preview camera modes', async () => {
    const poses = []
    for (const camera of ['full', 'bust', 'face']) {
      const { owner, next } = fixture()
      next.mockImplementation(async (input) => {
        const motion = {
          ...chunk(input.fromFrame),
          profileId: input.profileId,
          seed: input.lease.seed,
        }
        for (const frame of motion.rotations)
          frame[17] = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2)
            .toArray()
        return { ok: true, chunk: motion }
      })
      owner.setCameraMode(camera)
      await owner.playProfile('presence_warm', { ...context, animationId: 'presence_warm' })
      await tick(owner, 60)
      poses.push(owner.getPresentation()?.bones)
      owner.detach()
      await owner.settleCancellation()
    }
    expect(poses[0]).toBeDefined()
    expect(poses[1]).toEqual(poses[0])
    expect(poses[2]).toEqual(poses[0])
  })
  it('keeps source rotations in model space when the avatar scene is rotated', async () => {
    const { owner, bones, next } = fixture('1', Math.PI / 2)
    const motion = chunk()
    for (const frame of motion.rotations)
      frame[19] = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2).toArray()
    next.mockResolvedValueOnce({ ok: true, chunk: motion })
    await owner.playProfile('presence_poised', context)
    owner.update(0.01, () => undefined)
    expect(Math.abs(bones.get('rightHand')?.quaternion.x ?? 0)).toBeLessThan(0.001)
    expect(bones.get('rightHand')?.quaternion.z).toBeGreaterThan(0)
    owner.detach()
    await owner.settleCancellation()
  })
  it('rejects non-unit, non-finite and unknown protocol output', () => {
    const valid = chunk()
    // Worker output binds the exact avatar generation and phase plan.
    const wire = valid
    expect(motionChunkSchema.safeParse(wire).success).toBe(true)
    expect(
      motionChunkSchema.safeParse({ ...wire, skeleton: 'core27-standard-tpose-v1' }).success,
    ).toBe(false)
    expect(
      motionChunkSchema.safeParse({ ...wire, rotations: wire.rotations.slice(0, 8) }).success,
    ).toBe(false)
    expect(
      motionChunkSchema.safeParse({
        ...wire,
        rotations: wire.rotations.map((frame) => frame.slice(0, 27)),
      }).success,
    ).toBe(false)
    wire.rotations[0][0] = [0, 0, 0, 0]
    expect(motionChunkSchema.safeParse(wire).success).toBe(false)
    wire.rotations[0][0] = [NaN, 0, 0, 1]
    expect(motionChunkSchema.safeParse(wire).success).toBe(false)
  })
  it.each(['0', '1'])(
    'retargets world axes for VRM %s without admitting facial bones',
    async (version) => {
      const { owner, bones, next } = fixture(version)
      const motion = chunk()
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2)
      for (const frame of motion.rotations) frame[19] = rotation.toArray()
      next.mockResolvedValueOnce({ ok: true, chunk: motion })
      await owner.playProfile('presence_poised', context)
      owner.update(0.1, () => undefined)
      expect(Math.sign(bones.get('rightHand')?.quaternion.z ?? 0)).toBe(version === '0' ? -1 : 1)
      expect(bones.get('jaw')?.quaternion.toArray()).toEqual([0, 0, 0, 1])
      owner.detach()
      await owner.settleCancellation()
    },
  )
  it('follows the consumed PCM clock, holds on underrun and leaves face bones untouched', async () => {
    const { owner, bones } = fixture()
    for (const name of ['head', 'neck', 'leftEye', 'jaw'])
      bones.get(name)?.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2)
    await owner.playProfile('presence_poised', context)
    const before = bones.get('head')?.quaternion.clone()
    expect(before).toBeDefined()
    owner.setClock({
      turnId: 'turn',
      playbackId: 'pcm',
      sourceSampleRate: 44100,
      sourceSampleOffset: 0,
      state: 'playing',
    })
    owner.update(0.1, () => undefined)
    owner.setClock({
      turnId: 'turn',
      playbackId: 'pcm',
      sourceSampleRate: 44100,
      sourceSampleOffset: 4410,
      state: 'playing',
    })
    owner.update(0.1, () => undefined)
    expect(owner.getBodyMotionDebugState().sourceTimeSeconds).toBeCloseTo(0.1)
    owner.setClock({
      turnId: 'turn',
      playbackId: 'pcm',
      sourceSampleRate: 44100,
      sourceSampleOffset: 4410,
      state: 'buffering',
    })
    owner.update(1, () => undefined)
    expect(owner.getBodyMotionDebugState().sourceTimeSeconds).toBeCloseTo(0.1)
    expect(bones.get('head')?.quaternion.toArray()).toEqual(before?.toArray())
    owner.detach()
    await owner.settleCancellation()
  })
  it('integrates body safety at a continuous cadence between quantized PCM reports', async () => {
    const { owner } = fixture()
    const safety = vi.spyOn(GeneratedBodySafety.prototype, 'apply')
    try {
      await owner.playProfile('presence_poised', context)
      for (let frame = 0; frame < 120; frame++) {
        owner.setClock({
          turnId: 'turn',
          playbackId: 'pcm',
          sourceSampleRate: 44100,
          sourceSampleOffset: Math.floor(
            ((Math.floor(((frame / 60) * 48000) / 512) * 512) / 48000) * 44100,
          ),
          state: 'playing',
        })
        owner.update(1 / 60, () => undefined)
        await flush()
      }
      const steady = safety.mock.calls.slice(-60)
      expect(steady).toHaveLength(60)
      for (const [seconds, , advancing] of steady) {
        expect(advancing).toBe(true)
        expect(seconds).toBeGreaterThan(0.015)
        expect(seconds).toBeLessThan(0.018)
      }
    } finally {
      safety.mockRestore()
    }
  })
  it('invalidates queued poses immediately and awaits real adapter cancellation', async () => {
    const { owner, stop } = fixture()
    await owner.playProfile('presence_poised', context)
    let release!: () => void
    stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true })
        }),
    )
    owner.stopAnimation()
    expect(owner.getPresentation()).toBeNull()
    expect(owner.isAnimationPlaying()).toBe(false)
    let settled = false
    const cancelled = owner.settleCancellation().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await cancelled
    expect(settled).toBe(true)
  })
  it('interpolates generated root translation between source samples', async () => {
    const { owner, bones, next } = fixture()
    const motion = chunk()
    motion.rootPositions[1][1] -= 0.02
    next.mockResolvedValueOnce({ ok: true, chunk: motion })
    await owner.playProfile('presence_poised', context)
    owner.update(0.025, () => undefined)
    const firstY = bones.get('hips')?.position.y ?? 0
    expect(firstY).toBeLessThan(0.9887084839474641)
    expect(firstY).toBeGreaterThan(0.9887084839474641 - 0.002)
    owner.update(0.025, () => undefined)
    expect(bones.get('hips')?.position.y).toBeLessThan(firstY)
    owner.detach()
    await owner.settleCancellation()
  })
  it('composes one final safety pass and bounds noisy standing motion on a connected rig', async () => {
    const { owner, bones, next } = fixture('1', 0.7, true)
    const safety = vi.spyOn(GeneratedBodySafety.prototype, 'apply')
    next.mockImplementation(async (input) => {
      const motion = {
        ...chunk(input.fromFrame),
        profileId: input.profileId,
        seed: input.lease.seed,
      }
      for (const [index, frame] of motion.rotations.entries()) {
        frame[0] = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3)
          .toArray()
        frame[1] = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.3)
          .toArray()
        frame[3] = frame[0]
        motion.rootPositions[index][1] += index % 2 ? 0.015 : -0.015
      }
      return { ok: true, chunk: motion }
    })
    await owner.playProfile('presence_poised', context)
    let previousKnee: THREE.Vector3 | null = null
    let maximumKneeStep = 0
    for (let index = 0; index < 180; index++) {
      safety.mockClear()
      owner.update(1 / 60, () => undefined)
      expect(safety).toHaveBeenCalledTimes(1)
      await flush()
      const knee = bones.get('rightLowerLeg')?.getWorldPosition(new THREE.Vector3())
      if (knee && previousKnee && index > 30)
        maximumKneeStep = Math.max(maximumKneeStep, knee.distanceTo(previousKnee))
      previousKnee = knee ?? null
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
        bones.get('chest')?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion(),
      )
      expect(Math.acos(THREE.MathUtils.clamp(up.y, -1, 1))).toBeLessThan(0.09)
    }
    expect(maximumKneeStep).toBeLessThan(0.004)
    owner.detach()
    await owner.settleCancellation()
    safety.mockRestore()
  })
  it('recomposes a held PCM pose from its base instead of accumulating final corrections', async () => {
    const { owner, bones } = fixture()
    const elbow = bones.get('rightLowerArm')
    if (!elbow) throw new Error('Missing elbow')
    const safety = vi.spyOn(GeneratedBodySafety.prototype, 'apply').mockImplementation(() => {
      elbow.rotation.y += 0.1
    })
    await owner.playProfile('presence_poised', context)
    owner.update(0.05, () => undefined)
    owner.setClock({
      turnId: 'held-turn',
      playbackId: 'held-pcm',
      sourceSampleRate: 44100,
      sourceSampleOffset: 4410,
      state: 'buffering',
    })
    owner.update(1 / 60, () => undefined)
    const held = elbow.quaternion.clone()
    for (let frame = 0; frame < 30; frame++) {
      owner.update(1 / 60, () => undefined)
      await flush()
      expect(elbow.quaternion.angleTo(held)).toBeLessThan(1e-6)
    }
    owner.detach()
    await owner.settleCancellation()
    safety.mockRestore()
  })
  it('holds generated body and hand transforms when an audible PCM cursor buffers', async () => {
    const { owner, bones } = fixture()
    await owner.playProfile('presence_poised', context)
    owner.setClock({
      turnId: 't',
      playbackId: 'p',
      sourceSampleRate: 44100,
      sourceSampleOffset: 441,
      state: 'playing',
    })
    await tick(owner, 2)
    owner.setClock({
      turnId: 't',
      playbackId: 'p',
      sourceSampleRate: 44100,
      sourceSampleOffset: 441,
      state: 'buffering',
    })
    await tick(owner)
    const held = bones.get('rightHand')?.quaternion.clone()
    const heldFinger = bones.get('rightRingProximal')?.quaternion.clone()
    const cursor = owner.getBodyMotionDebugState().sourceTimeSeconds
    await tick(owner, 10)
    expect(bones.get('rightHand')?.quaternion.toArray()).toEqual(held?.toArray())
    expect(bones.get('rightRingProximal')?.quaternion.toArray()).toEqual(heldFinger?.toArray())
    expect(owner.getBodyMotionDebugState().sourceTimeSeconds).toBe(cursor)
    owner.detach()
    await owner.settleCancellation()
  })
  it('publishes composed body contributions including the breathing chest position', async () => {
    const { owner, bones } = fixture()
    await owner.playProfile('presence_poised', context)
    owner.update(0.01, () => {
      const chest = bones.get('chest')
      if (!chest) throw new Error('Missing fixture chest')
      chest.position.y = 0.003
      chest.rotation.y = 0.04
    })
    expect(owner.getPresentation()?.chestPosition).toEqual([0, 0.003, 0])
    expect(owner.getPresentation()?.bones.chest).toEqual(bones.get('chest')?.quaternion.toArray())
    owner.detach()
    await owner.settleCancellation()
  })
  it('interpolates the authoritative mirror pose without a second generator', () => {
    const { owner, bones, next } = fixture()
    owner.setPresentationOnly(true)
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6)
    owner.setMirror({
      lease,
      profileId: 'presence_poised',
      frame: 1,
      bones: { rightHand: rotation.toArray() },
      hipsPosition: [0, 0.94, 0],
      chestPosition: [0, 0.002, 0],
    })
    owner.update(1 / 60, () => undefined)
    const first = bones.get('rightHand')?.quaternion.angleTo(new THREE.Quaternion())
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(0.6)
    owner.update(1 / 60, () => undefined)
    expect(bones.get('rightHand')?.quaternion.angleTo(rotation)).toBeLessThan(0.001)
    expect(bones.get('chest')?.position.y).toBeCloseTo(0.002)
    expect(next).not.toHaveBeenCalled()
    owner.setMirror(null)
    owner.update(1 / 60, () => undefined)
    expect(bones.get('chest')?.position.y).toBeCloseTo(0.002)
    expect(owner.getBodyMotionDebugState().generated?.state).toBe('stopped')
    owner.detach()
  })
  it('preserves recovery timing across coalesced projections with a held source cursor', () => {
    const { owner, bones } = fixture()
    owner.setPresentationOnly(true)
    const projection = {
      lease,
      profileId: 'presence_poised' as const,
      frame: 10,
      localRecovery: true,
      composedAtMs: 100,
      bones: { rightHand: [0, 0, 0, 1] as [number, number, number, number] },
      hipsPosition: [0, 0.94, 0] as [number, number, number],
    }
    owner.setMirror(projection)
    owner.update(1 / 30, () => undefined)
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.08)
    owner.setMirror({ ...projection, composedAtMs: 180, bones: { rightHand: target.toArray() } })
    owner.update(0.04, () => undefined)
    expect(bones.get('rightHand')?.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0.04)
    owner.setMirror({ ...projection, composedAtMs: 160 })
    owner.update(0.04, () => undefined)
    expect(bones.get('rightHand')?.quaternion.angleTo(target)).toBeLessThan(0.00001)
    const rebound = target.clone().multiply(target)
    owner.setMirror({
      ...projection,
      lease: { ...lease, avatarGeneration: lease.avatarGeneration + 1 },
      composedAtMs: 10,
      bones: { rightHand: rebound.toArray() },
    })
    owner.update(1 / 30, () => undefined)
    expect(bones.get('rightHand')?.quaternion.angleTo(rebound)).toBeLessThan(0.00001)
    owner.detach()
  })
  it('projects the composed fingers and invalidates their execution without a cancellation snap', async () => {
    const { owner, bones } = fixture()
    await owner.playProfile('peace_single', {
      ...context,
      animationId: 'peace_single',
    })
    await tick(owner, Math.ceil((getMotionProfile('peace_single')?.phases[0].minMs ?? 0) / 50) + 2)
    const ring = bones.get('rightRingProximal')
    const index = bones.get('rightIndexProximal')
    expect(ring?.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.8)
    expect(index?.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.2)
    const projection = owner.getPresentation()
    expect(bodyPresentationSchema.safeParse(projection).success).toBe(true)
    expect(projection?.bones.rightRingProximal).toEqual(ring?.quaternion.toArray())
    expect(projection?.bones).not.toHaveProperty('jaw')
    const lastValid = ring?.quaternion.toArray()
    owner.stopAnimation()
    await tick(owner, 5)
    expect(ring?.quaternion.toArray()).toEqual(lastValid)
    expect(owner.getPresentation()?.lease).toBeNull()
    expect(owner.getPresentation()?.compositionSource).toBe('local')
    expect(owner.getPresentation()?.executionId).toBeUndefined()
    expect(owner.getBodyMotionDebugState().motionExecution?.outcome).toBe('cancelled')
    await owner.settleCancellation()
    owner.detach()
  })
  it('recovers the current hands before a delayed new semantic execution becomes ready', async () => {
    const { owner, next } = fixture()
    await owner.playProfile('presence_poised', context)
    await tick(owner, 6)
    let finish: ((value: { ok: boolean; chunk: MotionChunk }) => void) | undefined
    let requestedFrom = 0
    next.mockImplementation((input) => {
      if (input.profileId === 'resolve_firm') {
        requestedFrom = input.fromFrame
        return new Promise((resolve) => {
          finish = resolve
        })
      }
      return Promise.resolve({
        ok: true,
        chunk: { ...chunk(input.fromFrame), profileId: input.profileId, seed: input.lease.seed },
      })
    })
    const changed = owner.playProfile('resolve_firm', {
      ...context,
      animationId: 'resolve_firm',
    })
    void changed.catch(() => undefined)
    for (let frame = 0; frame < 60 && !finish; frame++) await tick(owner)
    expect(finish).toBeTypeOf('function')
    expect(requestedFrom).toBeGreaterThan(0)
    expect(requestedFrom % 4).toBe(0)
    expect(owner.getPresentation()).not.toBeNull()
    expect(owner.getBodyMotionDebugState().motionExecution?.phase).toBe('prepare')
    expect(owner.getBodyMotionDebugState().motionExecution?.outcome).toBeNull()
    const replacement = { ...chunk(requestedFrom), profileId: 'resolve_firm' as const }
    finish?.({ ok: true, chunk: replacement })
    await changed
    expect(owner.getBodyMotionDebugState().generated?.lateChunks).toBe(0)
    owner.detach()
    await owner.settleCancellation()
  })
  it('preserves a bounded lookahead when a PCM clock joins the existing body session', async () => {
    const { owner, next } = fixture()
    await owner.playProfile('presence_poised', context)
    for (let frame = 0; frame < 10; frame += 1) {
      owner.update(0, () => undefined)
      for (let step = 0; step < 5; step += 1) await Promise.resolve()
    }
    expect(owner.getBodyMotionDebugState().generated?.queueFrames).toBeGreaterThanOrEqual(16)
    expect(owner.getBodyMotionDebugState().generated?.queueFrames).toBeLessThanOrEqual(120)
    const previousCalls = next.mock.calls.length
    owner.setClock({
      turnId: 't',
      playbackId: 'p',
      sourceSampleRate: 44100,
      sourceSampleOffset: 0,
      state: 'playing',
    })
    owner.update(0, () => undefined)
    expect(next).toHaveBeenCalledTimes(previousCalls)
    owner.detach()
    await owner.settleCancellation()
  })
  it('keeps preparation pending until the exact execution receives its first horizon', async () => {
    const { owner, next } = fixture()
    let finish: ((value: { ok: boolean; chunk: MotionChunk }) => void) | undefined
    next.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    let ready = false
    const starting = owner
      .playProfile('peace_single', { ...context, animationId: 'peace_single' })
      .then(() => {
        ready = true
      })
    await flush()
    await tick(owner, 5)
    expect(ready).toBe(false)
    expect(owner.getBodyMotionDebugState().motionExecution?.phase).toBe('prepare')
    expect(owner.getBodyMotionDebugState().motionExecution?.outcome).toBeNull()
    expect(owner.getBodyMotionDebugState().sourceTimeSeconds).toBe(0)
    expect(finish).toBeTypeOf('function')
    finish?.({ ok: true, chunk: { ...chunk(), profileId: 'peace_single' } })
    await starting
    expect(ready).toBe(true)
    expect(owner.getBodyMotionDebugState().motionExecution?.phase).toBe('prepare')
    owner.detach()
    await owner.settleCancellation()
  })
  it('does not complete a one-shot while its next horizon is temporarily unavailable', async () => {
    const { owner, next } = fixture()
    await owner.playProfile('agree_soft', { ...context, animationId: 'agree_soft' })
    for (let frame = 0; frame < 70 && owner.getLibraryDebug().phase !== 'stroke'; frame++)
      await tick(owner)
    expect(owner.getLibraryDebug().phase).toBe('stroke')
    next.mockImplementation((input) => {
      const deferred = createDeferred<{ ok: boolean; chunk: MotionChunk }>()
      pendingHorizons.push({
        deferred,
        chunk: motionChunkSchema.parse({ ...chunk(input.fromFrame), profileId: input.profileId }),
      })
      return deferred.promise
    })
    // A SOMA horizon can retain up to two seconds of usable lead-in.
    await tick(owner, 60)
    expect(owner.getBodyMotionDebugState().generated?.state).toBe('loading')
    expect(owner.getLibraryDebug().outcome).toBeNull()
    expect(owner.isAnimationPlaying()).toBe(true)
    const held = owner.getBodyMotionDebugState().sourceTimeSeconds
    await tick(owner, 20)
    expect(owner.getBodyMotionDebugState().sourceTimeSeconds).toBe(held)
    owner.detach()
    await owner.settleCancellation()
  })
})
