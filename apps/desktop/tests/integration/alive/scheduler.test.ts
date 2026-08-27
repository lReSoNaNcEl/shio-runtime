import { describe, expect, it } from 'vitest'

import { SchedulerRuntime } from '../../../src/main/alive'

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

describe('Scheduler Runtime', () => {
  it('never overlaps asynchronous ticks and tears down deterministically', async () => {
    const scheduler = new SchedulerRuntime(5)
    let active = 0
    let maximumActive = 0
    let ticks = 0
    scheduler.start(async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      ticks += 1
      await wait(20)
      active -= 1
    })
    await wait(72)
    scheduler.dispose()
    await wait(25)
    expect(ticks).toBeGreaterThanOrEqual(2)
    expect(maximumActive).toBe(1)
    expect(scheduler.isRunning()).toBe(false)
  })
})
