import { afterEach, describe, expect, it, vi } from 'vitest'

import { SceneManager } from '../../../src/renderer/avatar/rendering/three/SceneManager'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function fixture() {
  let now = 0
  let nextId = 0
  const pending = new Map<number, FrameRequestCallback>()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const cancel = vi.fn((id: number) => {
    pending.delete(id)
  })
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId
    pending.set(id, callback)
    return id
  })
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  vi.stubGlobal('window', { devicePixelRatio: 1, removeEventListener: vi.fn() })
  const render = vi.fn()
  const disconnect = vi.fn()
  const manager = Object.assign(Object.create(SceneManager.prototype), {
    disposed: false,
    running: false,
    effectiveDpr: 1,
    renderQualityLogPending: false,
    renderer: { render },
    controls: { update: () => undefined },
    updateHandCamera: () => undefined,
    syncLookAtAnchor: () => undefined,
    resizeObserver: { disconnect },
  }) as SceneManager
  return {
    manager,
    render,
    request,
    pending,
    cancel,
    disconnect,
    advance: (time: number) => {
      now = time
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback(now)
    },
  }
}

describe('presentation GPU budget', () => {
  it.each([30, 60, 90, 120, 144, 165, 240, 360])('bounds draws on a %i Hz display', (refreshHz) => {
    const f = fixture()
    f.manager.start()
    for (let frame = 1; frame <= refreshHz; frame++) f.advance((frame * 1000) / refreshHz)
    expect(f.render.mock.calls.length).toBeGreaterThanOrEqual(Math.min(90, refreshHz))
    expect(f.render.mock.calls.length).toBeLessThanOrEqual(Math.min(90, refreshHz) + 1)
    expect(f.pending.size).toBe(1)
    f.manager.stop()
  })

  it('does not replay missed draws after a stall and tears down idempotently', () => {
    const f = fixture()
    f.manager.start()
    f.advance(5000)
    expect(f.render).toHaveBeenCalledTimes(2)
    expect(f.pending.size).toBe(1)
    f.manager.stop()
    f.manager.stop()
    f.advance(6000)
    expect(f.render).toHaveBeenCalledTimes(2)
    expect(f.cancel).toHaveBeenCalledTimes(1)
    expect(f.disconnect).toHaveBeenCalledTimes(1)
    expect(f.pending.size).toBe(0)
  })

  it('keeps one RAF owner and resets the render deadline on restart', () => {
    const f = fixture()
    f.manager.start()
    f.manager.start()
    expect(f.pending.size).toBe(1)
    expect(f.request).toHaveBeenCalledTimes(1)
    f.manager.stop()
    f.advance(5000)
    f.manager.start()
    expect(f.render).toHaveBeenCalledTimes(2)
    expect(f.pending.size).toBe(1)
    f.advance(5001)
    expect(f.render).toHaveBeenCalledTimes(2)
    f.advance(5020)
    expect(f.render).toHaveBeenCalledTimes(3)
    f.manager.stop()
  })
})
