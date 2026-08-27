import { describe, expect, it, vi } from 'vitest'

import { BrowserHeldInputRegistry } from '../../src/main/browser-control/playwright/BrowserHeldInputRegistry'

describe('BrowserHeldInputRegistry', () => {
  it('shares one held-input truth across Playwright and CDP owners', async () => {
    const registry = new BrowserHeldInputRegistry()
    const released: string[] = []
    registry.holdKey('playwright', 'Shift', async () => {
      released.push('playwright-key')
    })
    registry.holdKey('cdp', 'ArrowRight', async () => {
      released.push('cdp-key')
    })
    registry.holdButton('cdp', 'left', async () => {
      released.push('cdp-button')
    })

    expect(registry.snapshot()).toEqual({
      keys: ['Shift', 'ArrowRight'],
      buttons: ['left'],
    })
    await registry.releaseOwner('cdp')
    expect(registry.snapshot()).toEqual({ keys: ['Shift'], buttons: [] })
    expect(released).toEqual(expect.arrayContaining(['cdp-key', 'cdp-button']))

    await registry.releaseAll()
    expect(registry.snapshot()).toEqual({ keys: [], buttons: [] })
    expect(released).toContain('playwright-key')
  })

  it('releases a held input at its hard timeout and reports missing releases', async () => {
    vi.useFakeTimers()
    try {
      const registry = new BrowserHeldInputRegistry()
      const release = vi.fn(async () => undefined)
      registry.holdKey('cdp', 'ArrowLeft', release, 250)
      await vi.advanceTimersByTimeAsync(251)
      expect(release).toHaveBeenCalledOnce()
      expect(registry.isKeyHeld('cdp', 'ArrowLeft')).toBe(false)
      await expect(registry.releaseKey('cdp', 'ArrowLeft')).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
