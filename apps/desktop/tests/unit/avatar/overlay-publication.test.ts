import { afterEach, describe, expect, it, vi } from 'vitest'

import { OverlayRuntime } from '../../../src/renderer/runtime/OverlayRuntime'
import type { BodyPresentation } from '../../../src/shared/motion'

function pose(frame: number): BodyPresentation {
  return {
    lease: { sessionId: 'overlay', epoch: 1, modelGeneration: 1, avatarGeneration: 1, seed: 1 },
    profileId: 'presence_poised',
    frame,
    bones: { hips: [0, 0, 0, 1] },
    hipsPosition: [0, 1, 0],
  }
}

function fixture(publish = vi.fn(async (_value: BodyPresentation | null) => ({ ok: true }))) {
  vi.stubGlobal('window', { location: { search: '' }, api: { avatarBody: { publish } } })
  return { runtime: new OverlayRuntime(), publish }
}

async function settle() {
  for (let step = 0; step < 5; step += 1) await Promise.resolve()
}

afterEach(() => vi.unstubAllGlobals())

describe('Overlay body publication', () => {
  it('keeps the fractional timer remainder for a stable 30 Hz cadence', async () => {
    const { runtime, publish } = fixture()
    for (let frame = 0; frame < 125; frame += 1) {
      runtime.publishBodyFrame(0.016, pose(frame))
      await settle()
    }
    expect(publish.mock.calls.length).toBeGreaterThanOrEqual(59)
    expect(publish.mock.calls.length).toBeLessThanOrEqual(60)
    runtime.dispose()
  })

  it('retains only the latest pending pose while an IPC publication is in flight', async () => {
    const releases: Array<(result: { ok: boolean }) => void> = []
    const publish = vi.fn(
      (_value: BodyPresentation | null) =>
        new Promise<{ ok: boolean }>((resolve) => releases.push(resolve)),
    )
    const { runtime } = fixture(publish)
    for (let frame = 0; frame < 100; frame += 1) runtime.publishBodyFrame(1 / 30, pose(frame))
    expect(publish).toHaveBeenCalledTimes(1)
    releases[0]({ ok: true })
    await settle()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1][0]?.frame).toBe(99)
    releases[1]({ ok: true })
    await settle()
    runtime.dispose()
  })

  it('supersedes pending movement with cancellation and discards pending work on dispose', async () => {
    const releases: Array<(result: { ok: boolean }) => void> = []
    const publish = vi.fn(
      (_value: BodyPresentation | null) =>
        new Promise<{ ok: boolean }>((resolve) => releases.push(resolve)),
    )
    const { runtime } = fixture(publish)
    runtime.publishBodyFrame(1 / 30, pose(0))
    runtime.publishBodyFrame(1 / 30, pose(1))
    runtime.publishBodyFrame(0, null)
    releases[0]({ ok: true })
    await settle()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1][0]).toBeNull()
    runtime.publishBodyFrame(1 / 30, pose(2))
    runtime.dispose()
    releases[1]({ ok: true })
    await settle()
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('serializes one terminal release on dispose after the active pose and rejects new movement', async () => {
    const releases: Array<(result: { ok: boolean }) => void> = []
    const publish = vi.fn(
      (_value: BodyPresentation | null) =>
        new Promise<{ ok: boolean }>((resolve) => releases.push(resolve)),
    )
    const { runtime } = fixture(publish)
    runtime.publishBodyFrame(1 / 30, pose(0))
    runtime.publishBodyFrame(1 / 30, pose(1))
    runtime.dispose()
    runtime.dispose()
    runtime.publishBodyFrame(1 / 30, pose(2))
    expect(publish).toHaveBeenCalledTimes(1)
    releases[0]({ ok: true })
    await settle()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1][0]).toBeNull()
    runtime.dispose()
    releases[1]({ ok: true })
    await settle()
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('observes a rejected terminal release without restarting publication', async () => {
    const { runtime, publish } = fixture()
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    runtime.publishBodyFrame(1 / 30, pose(0))
    await settle()
    const failure = new Error('Overlay IPC disconnected')
    publish.mockRejectedValueOnce(failure)
    runtime.dispose()
    await settle()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1][0]).toBeNull()
    expect(report).toHaveBeenCalledWith('[Promise] publish Overlay body pose failed', failure)
    runtime.dispose()
    await settle()
    expect(publish).toHaveBeenCalledTimes(2)
    report.mockRestore()
  })
})
