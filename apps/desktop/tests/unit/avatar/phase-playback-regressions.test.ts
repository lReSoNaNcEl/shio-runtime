import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { GeneratedBodySafety } from '../../../src/renderer/avatar/rendering/three/GeneratedBodySafety'
import type { GeneratedMotionRequestContext } from '../../../src/renderer/avatar/rendering/three/GeneratedMotionTypes'
import {
  BODY_BONE_NAMES,
  getMotionProfile,
  type MotionApi,
  type MotionChunk,
  type MotionReply,
} from '../../../src/shared/motion'

const lease = {
  sessionId: 'phase-regression',
  epoch: 1,
  modelGeneration: 1,
  avatarGeneration: 1,
  seed: 42,
}
function chunk(input: Parameters<MotionApi['next']>[0]): MotionChunk {
  const fromFrame = input.fromFrame ?? 0
  return {
    ...input.lease,
    type: 'motion',
    id: fromFrame + 1,
    reset: fromFrame === 0,
    fromFrame,
    startFrame: fromFrame,
    profileId: input.profileId,
    protocolVersion: 2,
    skeleton: 'soma30-standard-tpose-v1',
    fps: 30,
    plan: input.plan,
    rotations: Array.from({ length: 60 }, () => Array.from({ length: 30 }, () => [0, 0, 0, 1])),
    rootPositions: Array.from({ length: 60 }, () => [0, 0.95, 0]),
    footContacts: Array.from({ length: 60 }, () => ({
      leftHeel: 1,
      leftToe: 1,
      rightHeel: 1,
      rightToe: 1,
    })),
    inferenceMs: 1,
  }
}
const owners: GeneratedBodyPlayback[] = []
function fixture() {
  const scene = new THREE.Scene()
  const bones = new Map<string, THREE.Object3D>()
  for (const name of [...BODY_BONE_NAMES, 'neck', 'head']) {
    const bone = new THREE.Object3D()
    scene.add(bone)
    bones.set(name, bone)
  }
  bones.get('hips')?.position.set(0, 0.95, 0)
  const vrm = {
    scene,
    meta: { metaVersion: '1' },
    humanoid: { getNormalizedBoneNode: (name: string) => bones.get(name) },
  } as unknown as VRM
  const next = vi.fn<MotionApi['next']>(async (input) => ({ ok: true, chunk: chunk(input) }))
  const stop = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('window', {
    api: { motion: { start: async () => ({ ok: true, lease }), next, stop } },
  })
  const owner = new GeneratedBodyPlayback(() => undefined)
  owners.push(owner)
  owner.attach(vrm)
  return { owner, next, bones }
}
function context(id = 'greet_wave_soft', speechBound = false): GeneratedMotionRequestContext {
  return {
    animationId: id,
    speechBound,
    behaviorId: 'test',
    source: 'debug-preview',
    reason: 'phase regression',
    previousAnimationId: null,
    forceReplay: false,
    motionLayer: 'gesture',
  }
}
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const owner of owners.splice(0)) {
    owner.detach()
    await owner.settleCancellation()
  }
  vi.unstubAllGlobals()
})

describe('generated phase timing regressions', () => {
  it('removes a cancelled speech preparation from the actual body queue before it can start', async () => {
    const { owner } = fixture()
    await owner.playProfile('presence_poised', context('presence_poised'))
    for (let frame = 0; frame < 30; frame++) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    const pending = owner
      .playProfile('greet_wave_soft', {
        ...context('greet_wave_soft', true),
        source: 'speaking-gesture-scheduler',
      })
      .then(
        () => null,
        (error: unknown) => error,
      )
    owner.releaseSpeechPreparation('greet_wave_soft')
    let witnessed = false
    for (let frame = 0; frame < 150; frame++) {
      owner.update(0.05, () => undefined)
      await flush()
      witnessed ||= owner.getLibraryDebug().runningProfileId === 'greet_wave_soft'
    }
    expect(await pending).toMatchObject({ message: 'ARDY_STALE_INTENT' })
    expect(witnessed).toBe(false)
  })

  it('releases a speech stroke without replanning behind an already accepted forecast', async () => {
    const { owner, next } = fixture()
    const phases = ['prepare', 'stroke', 'hold', 'recover']
    let accepted: Parameters<MotionApi['next']>[0]['plan'] | undefined
    next.mockImplementation(async (input) => {
      if (
        accepted?.executionId === input.plan.executionId &&
        phases.indexOf(input.plan.phaseId) < phases.indexOf(accepted.phaseId)
      )
        return { ok: false, error: 'ARDY_STALE_PLAN' }
      accepted = input.plan
      return { ok: true, chunk: chunk(input) }
    })
    await owner.playProfile('greet_wave_soft', context('greet_wave_soft', true))
    for (let frame = 0; frame < 110; frame++) {
      owner.update(0.02, () => undefined)
      await flush()
    }
    let offset = 0
    for (let frame = 0; frame < 180; frame++) {
      offset += 882
      owner.setClock({
        turnId: 'short-turn',
        playbackId: 'short-pcm',
        state: 'playing',
        sourceSampleRate: 44100,
        sourceSampleOffset: offset,
      })
      owner.update(0.02, () => undefined)
      await flush()
      if (owner.getLibraryDebug().phase === 'stroke' && accepted?.phaseId === 'hold') break
    }
    expect(owner.getLibraryDebug().phase).toBe('stroke')
    expect(accepted?.phaseId).toBe('hold')
    owner.setClock({
      turnId: 'short-turn',
      playbackId: 'short-pcm',
      state: 'ended',
      sourceSampleRate: 44100,
      sourceSampleOffset: offset,
    })
    for (let frame = 0; frame < 300; frame++) {
      owner.update(0.02, () => undefined)
      await flush()
    }
    expect(owner.getBodyMotionDebugState().generated?.error).toBeNull()
    expect(owner.getLibraryDebug().outcome).toBe('superseded')
  })

  it('supersedes queued automatic presence when a newer manual preview is requested', async () => {
    const { owner } = fixture()
    await owner.playProfile('presence_listening', context('presence_listening'))
    for (let frame = 0; frame < 12; frame++) {
      owner.update(0.025, () => undefined)
      await flush()
    }
    let automaticFailure = null
    void owner
      .playProfile('presence_poised', {
        ...context('presence_poised'),
        source: 'idle-orchestrator',
      })
      .catch((failure: Error) => {
        automaticFailure = failure.message
      })
    void owner.playProfile('agree_soft', context('agree_soft')).catch(() => undefined)
    let witnessed = false
    for (let frame = 0; frame < 360; frame++) {
      owner.update(0.025, () => undefined)
      await flush()
      witnessed ||= owner.getPresentation()?.profileId === 'agree_soft'
    }
    expect(automaticFailure).toBe('ARDY_PROFILE_SUPERSEDED')
    expect(witnessed).toBe(true)
  })

  it('yields a queued presence hold to the next eligible intent instead of starving it', async () => {
    const { owner } = fixture()
    const gesture = getMotionProfile('agree_soft')
    if (!gesture) throw new Error('Missing gesture fixture')
    const qualification = gesture.qualification.state
    gesture.qualification.state = 'qualified'
    try {
      await owner.playProfile('presence_listening', context('presence_listening'))
      for (let frame = 0; frame < 12; frame++) {
        owner.update(0.025, () => undefined)
        await flush()
      }
      void owner
        .playProfile('presence_poised', {
          ...context('presence_poised'),
          source: 'idle-orchestrator',
        })
        .catch(() => undefined)
      void owner
        .playProfile('agree_soft', { ...context('agree_soft'), source: 'queue' })
        .catch(() => undefined)
      const observed = new Set()
      for (let frame = 0; frame < 360; frame++) {
        owner.update(0.025, () => undefined)
        await flush()
        observed.add(owner.getPresentation()?.profileId)
      }
      expect(observed.has('presence_poised')).toBe(true)
      expect(observed.has('agree_soft')).toBe(true)
    } finally {
      gesture.qualification.state = qualification
    }
  })

  it('fails an unreachable spatial target at a fractional forecast boundary instead of hanging', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    vi.spyOn(GeneratedBodySafety.prototype, 'handTargetsReached').mockReturnValue(false)
    const { owner } = fixture()
    await owner.playProfile('greet_wave_soft', context('greet_wave_soft'))
    for (let frame = 0; frame < 220 && !owner.getLibraryDebug().outcome; frame++) {
      owner.update(0.025, () => undefined)
      await vi.advanceTimersByTimeAsync(25)
      await flush()
    }
    expect(owner.getLibraryDebug().outcome).toBe('failed')
    expect(owner.getBodyMotionDebugState().generated?.error).toBe('ARDY_SPATIAL_TARGET_UNREACHED')
    expect(owner.getPresentation()?.phaseId).not.toBe('stroke')
  })

  it('allows initial audible preparation the Main-owned readiness budget before failing', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    const { owner, next } = fixture()
    await owner.playProfile('greet_wave_soft', context('greet_wave_soft'))
    for (let frame = 0; frame < 300 && !owner.getLibraryDebug().outcome; frame++) {
      owner.update(0.025, () => undefined)
      await vi.advanceTimersByTimeAsync(25)
      await flush()
    }
    expect(owner.getLibraryDebug().outcome).toBe('completed')
    next.mockImplementationOnce(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 650))
      return { ok: true, chunk: chunk(input) }
    })
    const starting = owner.playProfile('presence_warm', context('presence_warm', true)).then(
      () => null,
      (error: unknown) => error,
    )
    for (let frame = 1; frame <= 80; frame++) {
      owner.setClock({
        turnId: 'turn-1',
        playbackId: 'pcm-1',
        state: 'playing',
        sourceSampleRate: 44100,
        sourceSampleOffset: frame * 882,
      })
      owner.update(0.02, () => undefined)
      await vi.advanceTimersByTimeAsync(20)
      await flush()
    }
    expect(await starting).toBeNull()
    expect(owner.getBodyMotionDebugState().generated?.error).toBeNull()
    expect(owner.getLibraryDebug().outcome).toBeNull()
  })

  it('discards a pending initial preparation when its consumed speech ends', async () => {
    const { owner, next } = fixture()
    await owner.playProfile('presence_poised', context('presence_poised'))
    for (let frame = 0; frame < 50; frame++) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    let release: ((value: MotionReply) => void) | undefined
    let pending: Parameters<MotionApi['next']>[0] | undefined
    next.mockImplementationOnce((input) => {
      pending = input
      return new Promise((resolve) => {
        release = resolve
      })
    })
    owner.recover()
    for (let frame = 0; frame < 100 && !owner.getLibraryDebug().outcome; frame++) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    const starting = owner.playProfile('presence_warm', context('presence_warm', true)).then(
      () => null,
      (error: unknown) => error,
    )
    owner.setClock({
      turnId: 'turn-1',
      playbackId: 'pcm-1',
      sourceSampleOffset: 4410,
      sourceSampleRate: 44100,
      state: 'playing',
    })
    owner.update(0.05, () => undefined)
    await flush()
    owner.setClock({
      turnId: 'turn-1',
      playbackId: 'pcm-1',
      sourceSampleOffset: 4410,
      sourceSampleRate: 44100,
      state: 'ended',
    })
    for (let frame = 0; frame < 80; frame++) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    if (!pending || !release) throw new Error('Missing owned delayed preparation')
    release({ ok: true, chunk: chunk(pending) })
    await flush()
    for (let frame = 0; frame < 10; frame++) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    expect(await starting).toBeInstanceOf(Error)
    expect(owner.getLibraryDebug().outcome).toBe('superseded')
    expect(owner.getPresentation()?.phaseId).not.toBe('stroke')
  })

  it('forecasts an exact horizon boundary before an already audible preparation ends', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    const { owner, next } = fixture()
    let strokeRequested = false
    next.mockImplementation(async (input) => {
      if (input.fromFrame !== 0 && (input.plan.phaseId === 'prepare' || !strokeRequested)) {
        if (input.plan.phaseId === 'stroke') strokeRequested = true
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      return { ok: true, chunk: chunk(input) }
    })
    await owner.playProfile('presence_warm', context('presence_warm', true))
    for (let frame = 1; frame <= 70; frame++) {
      owner.setClock({
        turnId: 'turn-1',
        playbackId: 'pcm-1',
        state: 'playing',
        sourceSampleRate: 44100,
        sourceSampleOffset: frame * 882,
      })
      owner.update(0.02, () => undefined)
      await vi.advanceTimersByTimeAsync(20)
      await flush()
    }
    expect(owner.getBodyMotionDebugState().generated?.error).toBeNull()
    expect(owner.getLibraryDebug().outcome).toBeNull()
    expect(owner.getLibraryDebug().phase).toBe('hold')
  })

  it('advances a prepared forecast across coarse consumed PCM updates without freezing at its boundary', async () => {
    const { owner } = fixture()
    await owner.playProfile('presence_warm', context('presence_warm', true))
    for (let frame = 0; frame < 100; frame++) {
      owner.update(0.02, () => undefined)
      await flush()
    }
    for (let frame = 1; frame <= 16; frame++) {
      owner.setClock({
        turnId: 'turn-1',
        playbackId: 'pcm-1',
        state: 'playing',
        sourceSampleRate: 44100,
        sourceSampleOffset: frame * 11025,
      })
      owner.update(0.25, () => undefined)
      await flush()
    }
    expect(owner.getLibraryDebug().phase).toBe('hold')
    expect(owner.getBodyMotionDebugState().generated?.error).toBeNull()
    expect(owner.getLibraryDebug().outcome).toBeNull()
  })

  it('prepares a delayed stroke before PCM without consuming its accent early', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    const { owner, next } = fixture()
    next.mockImplementation(async (input) => {
      if (input.plan.phaseId === 'stroke') await new Promise((resolve) => setTimeout(resolve, 500))
      return { ok: true, chunk: chunk(input) }
    })
    await owner.playProfile('presence_warm', context('presence_warm', true))
    for (let frame = 0; frame < 100; frame++) {
      owner.update(0.02, () => undefined)
      await vi.advanceTimersByTimeAsync(20)
      await flush()
      expect(owner.getBodyMotionDebugState().generated?.queueFrames).toBeLessThanOrEqual(120)
    }
    expect(owner.getPresentation()?.phaseId).toBe('prepare')
    for (let frame = 1; frame <= 60; frame++) {
      owner.setClock({
        turnId: 'turn-1',
        playbackId: 'pcm-1',
        state: 'playing',
        sourceSampleRate: 44100,
        sourceSampleOffset: frame * 882,
      })
      owner.update(0.02, () => undefined)
      await vi.advanceTimersByTimeAsync(20)
      await flush()
    }
    expect(owner.getBodyMotionDebugState().generated?.error).toBeNull()
    expect(owner.getPresentation()?.phaseId).not.toBe('recover')
    let expectedFrame = 0
    let prior: Parameters<MotionApi['next']>[0] | undefined
    const phases = getMotionProfile('presence_warm')?.phases.map((phase) => phase.id) ?? []
    for (const [request] of next.mock.calls) {
      const frame = request.fromFrame ?? 0
      expect(frame % 4).toBe(0)
      expect(frame).toBeGreaterThanOrEqual(Math.max(0, expectedFrame - 120))
      expect(frame).toBeLessThanOrEqual(expectedFrame)
      expectedFrame = frame + 60
      if (prior?.plan.executionId === request.plan.executionId) {
        expect(request.plan.planRevision).toBeGreaterThanOrEqual(prior.plan.planRevision)
        expect(phases.indexOf(request.plan.phaseId)).toBeGreaterThanOrEqual(
          phases.indexOf(prior.plan.phaseId),
        )
        if (request.plan.planRevision === prior.plan.planRevision) {
          expect(request.plan.clockDomain).toBe(prior.plan.clockDomain)
          expect(request.plan.playbackId).toBe(prior.plan.playbackId)
        }
      }
      prior = request
    }
  })

  it('starts the phase deadline after the Main-owned cold encoder warmup', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    const { owner } = fixture()
    let finish: ((value: Awaited<ReturnType<MotionApi['start']>>) => void) | undefined
    window.api.motion.start = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    const starting = owner.playProfile('presence_warm', context('presence_warm'))
    await flush()
    await vi.advanceTimersByTimeAsync(150_000)
    owner.update(0.05, () => undefined)
    expect(owner.getLibraryDebug().outcome).toBeNull()
    if (!finish) throw new Error('Missing owned startup')
    finish({ ok: true, lease })
    await flush()
    owner.update(0.05, () => undefined)
    await flush()
    await starting
    expect(owner.getBodyMotionDebugState().generated?.error).toBeNull()
  })

  it('consumes an accepted local lead-in while preparing the next physical phase', async () => {
    const { owner, next } = fixture()
    let request: Parameters<MotionApi['next']>[0] | undefined
    let release: ((reply: MotionReply) => void) | undefined
    next.mockImplementation((input) => {
      if (input.plan.phaseId === 'stroke' && !request) {
        request = input
        return new Promise((resolve) => {
          release = resolve
        })
      }
      return Promise.resolve({ ok: true, chunk: chunk(input) })
    })
    await owner.playProfile('greet_wave_soft', context('greet_wave_soft'))
    for (let frame = 0; frame < 60 && !request; frame++) {
      owner.update(0.025, () => undefined)
      await flush()
    }
    expect(request).toBeDefined()
    expect(owner.getLibraryDebug().phase).toBe('prepare')
    for (let frame = 0; frame < 100 && owner.getLibraryDebug().phase !== 'stroke'; frame++) {
      owner.update(0.025, () => undefined)
      await flush()
    }
    const before = owner.getBodyMotionDebugState().sourceTimeSeconds ?? 0
    for (let frame = 0; frame < 6; frame++) {
      owner.update(0.025, () => undefined)
      await flush()
    }
    expect(owner.getBodyMotionDebugState().sourceTimeSeconds).toBeGreaterThan(before + 0.1)
    expect(owner.getLibraryDebug().phase).toBe('stroke')
    expect(owner.getLibraryDebug().outcome).toBeNull()
    expect(owner.getBodyMotionDebugState().generated?.state).toBe('loading')
    if (!request || !release) throw new Error('No pending next phase')
    release({ ok: true, chunk: chunk(request) })
    await flush()
    owner.update(0.025, () => undefined)
    await flush()
    expect(owner.getPresentation()?.phaseId).toBe('stroke')
    expect(owner.getBodyMotionDebugState().generated?.planning?.progress).toBe(0)
  })
  it('never declares an opening stroke before its first audible sample', async () => {
    const { owner } = fixture()
    await owner.playProfile('greet_wave_soft', context('greet_wave_soft', true))
    owner.setClock({
      turnId: 'turn-1',
      playbackId: 'pcm-1',
      sourceSampleRate: 44_100,
      sourceSampleOffset: 0,
      state: 'buffering',
    })
    for (let index = 0; index < 50; index += 1) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    expect(owner.getLibraryDebug().phase).toBe('prepare')
    expect(owner.getLibraryDebug().outcome).toBeNull()
  })

  it('allows recovery before the first PCM instead of waiting forever for an opening accent', async () => {
    const { owner } = fixture()
    await owner.playProfile('greet_wave_soft', context('greet_wave_soft', true))
    owner.setClock({
      turnId: 'turn-1',
      playbackId: 'pcm-1',
      sourceSampleRate: 44_100,
      sourceSampleOffset: 0,
      state: 'buffering',
    })
    for (let index = 0; index < 40; index += 1) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    expect(owner.getLibraryDebug().phase).toBe('prepare')
    owner.recover()
    for (let index = 0; index < 60 && !owner.getLibraryDebug().outcome; index += 1) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    expect(owner.getLibraryDebug().outcome).toBe('superseded')
  })

  it('settles readiness after an audible playback identity replans a pending profile', async () => {
    const { owner } = fixture()
    await owner.playProfile('presence_poised', context('presence_poised'))
    owner.recover()
    for (let index = 0; index < 100 && !owner.getLibraryDebug().outcome; index += 1) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    expect(owner.getLibraryDebug().outcome).toBe('superseded')
    owner.setClock({
      turnId: 'turn-1',
      playbackId: 'pcm-1',
      sourceSampleRate: 44_100,
      sourceSampleOffset: 4410,
      state: 'playing',
    })
    let ready = false
    const request = owner.playProfile('greet_wave_soft', context('greet_wave_soft', true)).then(
      () => {
        ready = true
      },
      () => undefined,
    )
    for (let index = 0; index < 100 && !ready; index += 1) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    expect(ready).toBe(true)
    await request
  })

  it('holds the applied phase and fingers while consumed audio is buffering', async () => {
    const { owner, bones } = fixture()
    await owner.playProfile('greet_wave_soft', context('greet_wave_soft', true))
    const clock = {
      turnId: 'turn-1',
      playbackId: 'pcm-1',
      sourceSampleRate: 44_100,
      sourceSampleOffset: 4410,
      state: 'playing' as const,
    }
    owner.setClock(clock)
    for (let index = 0; index < 5; index += 1) {
      owner.update(0.01, () => undefined)
      await flush()
    }
    const heldTime = owner.getBodyMotionDebugState().sourceTimeSeconds
    const heldPhase = owner.getLibraryDebug().phase
    const heldFinger = bones.get('rightRingProximal')?.quaternion.toArray()
    owner.setClock({ ...clock, state: 'buffering' })
    for (let index = 0; index < 20; index += 1) {
      owner.update(0.1, () => undefined)
      await flush()
    }
    expect(owner.getBodyMotionDebugState().sourceTimeSeconds).toBe(heldTime)
    expect(owner.getLibraryDebug().phase).toBe(heldPhase)
    expect(bones.get('rightRingProximal')?.quaternion.toArray()).toEqual(heldFinger)
  })

  it('keeps a constant wrist target bounded instead of accumulating its previous offset', async () => {
    const { owner, bones } = fixture()
    await owner.playProfile('presence_warm', context('presence_warm'))
    for (let index = 0; index < 180; index += 1) {
      owner.update(0.05, () => undefined)
      await flush()
    }
    expect(owner.getLibraryDebug().phase).toBe('hold')
    const wrist = bones.get('rightHand')
    const angles = getMotionProfile('presence_warm')?.handScore.phases.hold.right.wristEuler
    if (!wrist || !angles) throw new Error('Missing wrist fixture')
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles, 'YXZ'))
    expect(wrist.quaternion.angleTo(target)).toBeLessThan(0.03)
  })

  it('retains accepted preparation horizons when actual PCM playback starts', async () => {
    const { owner } = fixture()
    await owner.playProfile('presence_warm', context('presence_warm', true))
    await flush()
    owner.update(0.05, () => undefined)
    const frame = owner.getBodyMotionDebugState().sourceTimeSeconds ?? 0
    expect(owner.getBodyMotionDebugState().generated?.queueFrames).toBeGreaterThan(0)
    owner.setClock({
      turnId: 'turn-1',
      playbackId: 'pcm-1',
      sourceSampleRate: 44100,
      sourceSampleOffset: 4410,
      state: 'playing',
    })
    owner.update(1 / 60, () => undefined)
    expect(owner.getBodyMotionDebugState().generated?.queueFrames).toBeGreaterThan(0)
    expect(owner.getBodyMotionDebugState().generated?.error).toBeNull()
    expect(owner.getBodyMotionDebugState().sourceTimeSeconds).toBeGreaterThanOrEqual(frame)
  })

  it('does not count a held fractional cursor as missed audio while a new phase is preparing', async () => {
    const { owner, next } = fixture()
    let release: ((reply: MotionReply) => void) | undefined
    let pending: Parameters<MotionApi['next']>[0] | undefined
    next.mockImplementation(async (input) => {
      if (input.plan.phaseId !== 'stroke') return { ok: true, chunk: chunk(input) }
      pending = input
      return new Promise((resolve) => {
        release = resolve
      })
    })
    await owner.playProfile('presence_warm', context('presence_warm', true))
    let offset = 0
    const clock = () =>
      owner.setClock({
        turnId: 'turn-1',
        playbackId: 'pcm-1',
        sourceSampleRate: 44100,
        sourceSampleOffset: offset,
        state: 'playing',
      })
    for (let index = 0; index < 150 && owner.getLibraryDebug().phase !== 'stroke'; index++) {
      offset += 573
      clock()
      owner.update(1 / 60, () => undefined)
      await flush()
    }
    expect(owner.getLibraryDebug().phase).toBe('stroke')
    for (let index = 0; index < 20; index++) {
      clock()
      owner.update(1 / 60, () => undefined)
      await flush()
    }
    const error = owner.getBodyMotionDebugState().generated?.error
    if (!pending || !release) throw new Error('Missing delayed stroke')
    release({ ok: true, chunk: chunk(pending) })
    await flush()
    expect(error).toBeNull()
  })

  it('does not replay elapsed speech time after a delayed horizon arrives', async () => {
    const { owner, next } = fixture()
    await owner.playProfile('presence_warm', context('presence_warm', true))
    await flush()
    let release: ((reply: MotionReply) => void) | undefined
    let delayed: Parameters<MotionApi['next']>[0] | undefined
    next.mockImplementationOnce((input) => {
      delayed = input
      return new Promise((resolve) => {
        release = resolve
      })
    })
    owner.setClock({
      turnId: 'turn-1',
      playbackId: 'pcm-1',
      sourceSampleRate: 44_100,
      sourceSampleOffset: 4410,
      state: 'playing',
    })
    owner.update(0.05, () => undefined)
    const held = owner.getBodyMotionDebugState().sourceTimeSeconds ?? 0
    owner.setClock({
      turnId: 'turn-1',
      playbackId: 'pcm-1',
      sourceSampleRate: 44_100,
      sourceSampleOffset: 132300,
      state: 'playing',
    })
    owner.update(0.05, () => undefined)
    expect(owner.getBodyMotionDebugState().generated?.error).toBe('ARDY_AUDIBLE_UNDERRUN')
    if (!release || !delayed) throw new Error('Missing delayed horizon')
    release({ ok: true, chunk: chunk(delayed) })
    await flush()
    owner.update(0.05, () => undefined)
    expect(owner.getBodyMotionDebugState().sourceTimeSeconds).toBeLessThanOrEqual(held + 0.1)
    expect(owner.getLibraryDebug().phase).not.toBe('stroke')
  })

  it('rejects a queued request on stop and ignores a late generated horizon', async () => {
    const { owner, next } = fixture()
    await owner.playProfile('greet_wave_soft', context())
    owner.update(0.05, () => undefined)
    let release: ((reply: MotionReply) => void) | undefined
    let delayed: Parameters<MotionApi['next']>[0] | undefined
    next.mockImplementationOnce((input) => {
      delayed = input
      return new Promise((resolve) => {
        release = resolve
      })
    })
    owner.update(0.05, () => undefined)
    const pending = owner.playProfile('reassure_palm', context('reassure_palm')).then(
      () => 'ready',
      () => 'cancelled',
    )
    owner.stopAnimation()
    expect(await pending).toBe('cancelled')
    const before = owner.getPresentation()
    if (release && delayed) release({ ok: true, chunk: chunk(delayed) })
    await flush()
    expect(owner.getPresentation()).toBe(before)
    expect(owner.getLibraryDebug().outcome).toBe('cancelled')
  })
})
