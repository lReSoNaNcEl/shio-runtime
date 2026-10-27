import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), exists: vi.fn(() => true) }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs', () => ({ existsSync: mocks.exists }))

import {
  getMotionProfile,
  MOTION_CATALOG_REVISION,
  MOTION_FORMAT,
  type MotionPlanIdentity,
} from '../../../src/shared/motion'

const plan: MotionPlanIdentity = {
  executionId: 'execution',
  planRevision: 0,
  catalogRevision: MOTION_CATALOG_REVISION as 'standing-v2-2026-10-27',
  phaseId: 'prepare',
  handScoreRevision: getMotionProfile('presence_poised')?.handScore.revision ?? 'missing-score',
  handRigCalibrationRevision: 'vrm-normalized-hands-v1',
  clockDomain: 'local',
  playbackId: null,
  continuityAnchor: 'anchor',
}

import { ArdyMotionService } from '../../../src/main/motion/ArdyMotionService'

function fixture(autoReady = true) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn((_line: string, callback: (error?: Error) => void) => callback()) },
    exitCode: null as number | null,
    kill: vi.fn(() => {
      queueMicrotask(() => {
        child.exitCode = 0
        child.emit('exit', 0)
      })
      return true
    }),
  })
  const ready = () =>
    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'ready', catalogRevision: MOTION_CATALOG_REVISION, format: MOTION_FORMAT })}\n`,
      ),
    )
  mocks.spawn.mockImplementation(() => {
    if (autoReady) queueMicrotask(ready)
    return child
  })
  let asset = 'asset-one'
  const service = new ArdyMotionService('D:/fixture/motion', () => asset)
  return {
    child,
    service,
    ready,
    replaceAsset: () => {
      asset = 'asset-two'
    },
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('Main-owned ARDY lifecycle', () => {
  it('allows a measured cold conditioning rebuild beyond the former two-minute cutoff', async () => {
    vi.useFakeTimers()
    const { child, service, ready } = fixture(false)
    const starting = service.start(10, 2, 17)
    await vi.advanceTimersByTimeAsync(150_000)
    expect(child.kill).not.toHaveBeenCalled()
    ready()
    expect((await starting).seed).toBe(17)
    await service.dispose()
  })

  it('reserves one owner during startup and cancels the real pending worker', async () => {
    const { child, service } = fixture(false)
    const starting = service.start(10, 2).catch((error) => error)
    await expect(service.start(11, 2)).rejects.toThrow('ARDY_BUSY')
    await service.stop(10, { avatarGeneration: 2 })
    expect((await starting).message).toMatch(/ARDY_INIT_FAILED|ARDY_CANCELLED/u)
    expect(child.kill).toHaveBeenCalledOnce()
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
      'ARDY_STALE_SESSION',
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
    expect((await pending).message).toBe('ARDY_DEADLINE_MISS')
    expect(child.kill).toHaveBeenCalledOnce()
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
    const chunk = {
      ...request,
      type: 'motion',
      seed: 43,
      skeleton: 'soma30-standard-tpose-v1',
      fps: 30,
      startFrame: 0,
      rotations: Array.from({ length: 60 }, () => Array.from({ length: 30 }, () => [0, 0, 0, 1])),
      rootPositions: Array.from({ length: 60 }, () => [0, 1, 0]),
      footContacts: Array.from({ length: 60 }, () => ({
        leftHeel: 1,
        leftToe: 1,
        rightHeel: 1,
        rightToe: 1,
      })),
      inferenceMs: 100,
    }
    child.stdout.emit('data', Buffer.from(`${JSON.stringify(chunk)}\n`))
    expect((await pending).message).toBe('ARDY_PROTOCOL_ERROR')
    expect(child.kill).toHaveBeenCalledOnce()
    await service.dispose()
  })
})
it('rejects backward phases and same-revision playback changes before provider work', async () => {
  const { child, service } = fixture()
  const lease = await service.start(10, 2, 42)
  const respond = () => {
    const request = JSON.parse(child.stdin.write.mock.calls.at(-1)?.[0] ?? '{}')
    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ ...request, type: 'motion', skeleton: 'soma30-standard-tpose-v1', fps: 30, startFrame: request.fromFrame, rotations: Array.from({ length: 60 }, () => Array.from({ length: 30 }, () => [0, 0, 0, 1])), rootPositions: Array.from({ length: 60 }, () => [0, 1, 0]), footContacts: Array.from({ length: 60 }, () => ({ leftHeel: 1, leftToe: 1, rightHeel: 1, rightToe: 1 })), inferenceMs: 100 })}\n`,
      ),
    )
  }
  const first = service.next(10, lease, 'presence_poised', 0, plan)
  respond()
  await first
  const holding = service.next(10, lease, 'presence_poised', 8, { ...plan, phaseId: 'hold' })
  respond()
  await holding
  await expect(
    service.next(10, lease, 'presence_poised', 16, { ...plan, phaseId: 'stroke' }),
  ).rejects.toThrow('ARDY_STALE_PLAN')
  await expect(
    service.next(10, lease, 'presence_poised', 16, {
      ...plan,
      phaseId: 'hold',
      clockDomain: 'speech',
      playbackId: 'p',
    }),
  ).rejects.toThrow('ARDY_STALE_PLAN')
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
  await expect(service.reroll(10, seeded, -1)).rejects.toThrow('ARDY_INVALID_SEED')
  await expect(service.reroll(10, seeded, 2_147_483_648)).rejects.toThrow('ARDY_INVALID_SEED')
  await expect(service.reroll(10, seeded, Number.NaN)).rejects.toThrow('ARDY_INVALID_SEED')
  expect(service.status().session?.seed).toBe(0)
  await service.dispose()
})
