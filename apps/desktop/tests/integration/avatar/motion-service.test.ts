import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), exists: vi.fn(() => true) }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs', () => ({ existsSync: mocks.exists }))

import {
  FLASH_MOTION_FORMAT,
  getMotionProfile,
  MOTION_CATALOG_REVISION,
  type MotionPlanIdentity,
} from '../../../src/shared/motion'

const plan: MotionPlanIdentity = {
  executionId: 'execution',
  planRevision: 0,
  catalogRevision: MOTION_CATALOG_REVISION,
  phaseId: 'prepare',
  handScoreRevision: getMotionProfile('presence_poised')?.handScore.revision ?? 'missing-score',
  handRigCalibrationRevision: 'vrm-normalized-hands-v1',
  clockDomain: 'local',
  playbackId: null,
  continuityAnchor: 'anchor',
}

import { GeneratedMotionService } from '../../../src/main/motion/GeneratedMotionService'
import { createMotionChunk } from '../../support/avatar/motionFixtures'

const flashReady = {
  type: 'ready',
  catalogRevision: MOTION_CATALOG_REVISION,
  protocolVersion: 1,
  sourceRevision: FLASH_MOTION_FORMAT.sourceRevision,
  weightsRevision: FLASH_MOTION_FORMAT.weightsRevision,
}

function workerChild(exitOnEof = true) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: {
      write: vi.fn((_line: string, callback: (error?: Error) => void) => callback()),
      end: vi.fn(() => {
        if (exitOnEof) queueMicrotask(exit)
      }),
    },
    exitCode: null as number | null,
  })
  const exit = () => {
    child.exitCode = 0
    child.emit('exit', 0)
  }
  const ready = () => child.stdout.emit('data', Buffer.from(`${JSON.stringify(flashReady)}\n`))
  return { child, ready, exit }
}

function fixture(autoReady = true) {
  const { child, ready } = workerChild()
  mocks.spawn.mockImplementation(() => {
    if (autoReady) queueMicrotask(ready)
    return child
  })
  let asset = 'asset-one'
  const service = new GeneratedMotionService('D:/fixture/motion', () => asset)
  return {
    child,
    service,
    ready,
    replaceAsset: () => {
      asset = 'asset-two'
    },
  }
}

function response(request: Record<string, unknown>, seed = request.seed) {
  const { frames, activity: _activity, speech: _speech, ...identity } = request
  const chunk = createMotionChunk()
  const size = typeof frames === 'number' ? frames : 24
  return {
    ...chunk,
    ...identity,
    seed,
    startFrame: request.fromFrame,
    sourceProvider: 'flashmotion',
    flashMotion: { mode: 't2m', weightsRevision: FLASH_MOTION_FORMAT.weightsRevision },
    rotations: chunk.rotations.slice(0, size),
    rootPositions: chunk.rootPositions.slice(0, size),
    footContacts: chunk.footContacts.slice(0, size),
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

it('reports explicit disabled state and cannot start a worker through renderer demand', async () => {
  const service = new GeneratedMotionService('D:/fixture/flashmotion', () => '', false)
  await expect(service.start(10, 2)).rejects.toThrow('MOTION_DISABLED')
  expect(service.status().error).toBe('MOTION_DISABLED')
  expect(mocks.spawn).not.toHaveBeenCalled()
  await service.dispose()
})

it('preserves inference failure separately from a malformed worker protocol', async () => {
  const { service, child } = fixture()
  const lease = await service.start(10, 2, 17)
  const pending = service.next(10, lease, 'presence_poised', undefined, plan)
  child.stdout.emit('data', Buffer.from('{"type":"error","code":"ValueError"}\n'))
  await expect(pending).rejects.toThrow('MOTION_INFERENCE_FAILED')
  await service.dispose()
})

describe('Main-owned generated motion lifecycle', () => {
  it('accepts the pinned FlashMotion identity', async () => {
    const { service } = fixture(true)
    expect((await service.start(10, 2, 17)).seed).toBe(17)
    await service.dispose()
  })

  it('ends the worker input and waits for a confirmed process exit', async () => {
    const { service, child } = fixture()
    const lease = await service.start(10, 2, 17)
    await service.stop(10, lease)
    expect(child.stdin.end).toHaveBeenCalledOnce()
    expect(service.status().state).toBe('unavailable')
    await service.dispose()
  })

  it('rejects a worker with an unqualified source identity', async () => {
    const { service, child } = fixture(false)
    const starting = service.start(10, 2, 17)
    child.stdout.emit(
      'data',
      Buffer.from(`${JSON.stringify({ ...flashReady, sourceRevision: 'unqualified-source' })}\n`),
    )
    await expect(starting).rejects.toThrow('MOTION_PROVIDER_IDENTITY_MISMATCH')
    await service.dispose()
  })

  it('allows cold model initialization within its longer startup deadline', async () => {
    vi.useFakeTimers()
    const { child, service, ready } = fixture(false)
    const starting = service.start(10, 2, 17)
    await vi.advanceTimersByTimeAsync(150_000)
    expect(child.stdin.end).not.toHaveBeenCalled()
    ready()
    expect((await starting).seed).toBe(17)
    await service.dispose()
  })

  it('reserves one owner during startup and cancels the real pending worker', async () => {
    const { child, service } = fixture(false)
    const starting = service.start(10, 2).catch((error) => error)
    await expect(service.start(11, 2)).rejects.toThrow('MOTION_BUSY')
    await service.stop(10, { avatarGeneration: 2 })
    expect((await starting).message).toMatch(/MOTION_INIT_FAILED|MOTION_CANCELLED/u)
    expect(child.stdin.end).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('rejects authority from a replaced model and keeps credentials out of the worker', async () => {
    vi.stubEnv('HF_TOKEN', 'test-secret')
    vi.stubEnv('GROQ_API_KEY', 'test-secret')
    const { service, replaceAsset } = fixture()
    const lease = await service.start(10, 2, 42)
    const environment = mocks.spawn.mock.calls[0][2].env
    expect(environment.HF_TOKEN).toBeUndefined()
    expect(environment.GROQ_API_KEY).toBeUndefined()
    expect(environment.HF_HUB_OFFLINE).toBe('1')
    replaceAsset()
    await expect(service.next(10, lease, 'presence_poised', undefined, plan)).rejects.toThrow(
      'MOTION_STALE_SESSION',
    )
    await service.dispose()
  })

  it('terminates a missed generation deadline before accepting another worker', async () => {
    vi.useFakeTimers()
    const { child, service } = fixture()
    const lease = await service.start(10, 2, 42)
    const pending = service
      .next(10, lease, 'presence_poised', undefined, plan)
      .catch((error) => error)
    await vi.advanceTimersByTimeAsync(2501)
    expect((await pending).message).toBe('MOTION_DEADLINE_MISS')
    expect(child.stdin.end).toHaveBeenCalledOnce()
    expect(service.status().session).toBeNull()
    await service.dispose()
  })

  it('contains a valid-shaped but stale seed instead of applying its pose', async () => {
    const { child, service } = fixture()
    const lease = await service.start(10, 2, 42)
    const pending = service
      .next(10, lease, 'presence_poised', undefined, plan)
      .catch((error) => error)
    const request = JSON.parse(child.stdin.write.mock.calls[0][0])
    const chunk = response(request, 43)
    child.stdout.emit('data', Buffer.from(`${JSON.stringify(chunk)}\n`))
    expect((await pending).message).toBe('MOTION_STALE_OR_INVALID_CHUNK')
    expect(child.stdin.end).toHaveBeenCalledOnce()
    await service.dispose()
  })
})
it('rejects backward phases and same-revision playback changes before provider work', async () => {
  const { child, service } = fixture()
  const lease = await service.start(10, 2, 42)
  const respond = () => {
    const request = JSON.parse(child.stdin.write.mock.calls.at(-1)?.[0] ?? '{}')
    child.stdout.emit('data', Buffer.from(`${JSON.stringify(response(request))}\n`))
  }
  const first = service.next(10, lease, 'presence_poised', 0, plan)
  respond()
  await first
  const holding = service.next(10, lease, 'presence_poised', 8, { ...plan, phaseId: 'hold' })
  respond()
  await holding
  await expect(
    service.next(10, lease, 'presence_poised', 16, { ...plan, phaseId: 'stroke' }),
  ).rejects.toThrow('MOTION_STALE_PLAN')
  await expect(
    service.next(10, lease, 'presence_poised', 16, {
      ...plan,
      phaseId: 'hold',
      clockDomain: 'speech',
      playbackId: 'p',
    }),
  ).rejects.toThrow('MOTION_STALE_PLAN')
  const clockChanged = service.next(10, lease, 'presence_poised', 16, {
    ...plan,
    planRevision: 1,
    phaseId: 'hold',
    clockDomain: 'speech',
    playbackId: 'p',
  })
  respond()
  await clockChanged
  expect(child.stdin.write).toHaveBeenCalledTimes(3)
  await service.dispose()
})
it('accepts an exact bounded seed without replacing the generator lease and rejects invalid values', async () => {
  const { service } = fixture()
  const lease = await service.start(10, 2, 42)
  const seeded = await service.reroll(10, lease, 0)
  expect(seeded).toEqual({ ...lease, seed: 0 })
  expect(seeded.sessionId).toBe(lease.sessionId)
  await expect(service.reroll(10, seeded, -1)).rejects.toThrow('MOTION_INVALID_SEED')
  await expect(service.reroll(10, seeded, 2_147_483_648)).rejects.toThrow('MOTION_INVALID_SEED')
  await expect(service.reroll(10, seeded, Number.NaN)).rejects.toThrow('MOTION_INVALID_SEED')
  expect(service.status().session?.seed).toBe(0)
  await service.dispose()
})

describe('FlashMotion worker termination failure policy', () => {
  function terminationFixture() {
    const workers: ReturnType<typeof workerChild>[] = []
    mocks.spawn.mockImplementation(() => {
      const worker = workerChild(false)
      workers.push(worker)
      queueMicrotask(worker.ready)
      return worker.child
    })
    const service = new GeneratedMotionService('D:/fixture/motion', () => 'asset')
    return { service, workers }
  }

  it('lifts the block when an unconfirmed worker exits after the termination deadline', async () => {
    vi.useFakeTimers()
    const { service, workers } = terminationFixture()
    const lease = await service.start(10, 2, 17)
    const stopping = service.stop(10, lease).catch((error) => error)
    await vi.advanceTimersByTimeAsync(5001)
    expect((await stopping).message).toBe('MOTION_TERMINATION_FAILED')
    await expect(service.start(11, 2)).rejects.toThrow('MOTION_TERMINATION_FAILED')
    expect(workers).toHaveLength(1)
    workers[0].exit()
    expect(service.status().state).toBe('unavailable')
    expect((await service.start(11, 3, 5)).seed).toBe(5)
    expect(workers).toHaveLength(2)
    const disposing = service.dispose()
    workers[1].exit()
    await disposing
    expect(service.status().state).toBe('closed')
  })

  it('reports a closed service after a confirmed late exit during application shutdown', async () => {
    vi.useFakeTimers()
    const { service, workers } = terminationFixture()
    await service.start(10, 2, 17)
    const disposing = service.dispose().catch((error) => error)
    await vi.advanceTimersByTimeAsync(5001)
    expect((await disposing).message).toBe('MOTION_TERMINATION_FAILED')
    workers[0].exit()
    expect(service.status().state).toBe('closed')
    await expect(service.start(11, 2)).rejects.toThrow('MOTION_CLOSED')
  })
})
