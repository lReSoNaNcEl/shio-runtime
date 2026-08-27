import { access } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  createDeferred,
  createTempDirectory,
  eventually,
  TestClock,
  TestEventCollector,
} from '../../support'

describe('Desktop test kit', () => {
  it('controls deterministic domain time without replacing global timers', () => {
    const clock = new TestClock(100)
    clock.advanceBy(25)
    expect(clock.now()).toBe(125)
    clock.reset()
    expect(clock.now()).toBe(100)
  })

  it('exposes externally controlled promises', async () => {
    const deferred = createDeferred<string>()
    deferred.resolve('done')
    await expect(deferred.promise).resolves.toBe('done')
  })

  it('collects events in delivery order', () => {
    const events = new TestEventCollector<number>()
    events.add(1)
    events.add(2)
    expect(events.all()).toEqual([1, 2])
    expect(events.last()).toBe(2)
  })

  it('retries transient assertions', async () => {
    let attempts = 0
    await eventually(
      () => {
        attempts += 1
        expect(attempts).toBeGreaterThan(1)
      },
      { intervalMs: 1, timeoutMs: 100 },
    )
  })

  it('removes temporary directories idempotently', async () => {
    const directory = await createTempDirectory()
    await access(directory.path)
    await directory.cleanup()
    await directory.cleanup()
    await expect(access(directory.path)).rejects.toThrow()
  })
})
