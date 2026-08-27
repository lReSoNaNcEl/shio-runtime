import { describe, expect, it } from 'vitest'

import { PlaywrightCdpFrameStream } from '../../src/main/browser-control/playwright/PlaywrightCdpFrameStream'

describe('PlaywrightCdpFrameStream', () => {
  it('ACKs every frame and processes only the newest pending frame', async () => {
    const handlers = new Map<string, (payload: unknown) => void>()
    const sends: Array<{ method: string; payload?: unknown }> = []
    const session = {
      on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
      send: async (method: string, payload?: unknown) => {
        sends.push({ method, payload })
        return {}
      },
      detach: async () => undefined,
    }
    const pageHandlers = new Map<string, (...args: unknown[]) => void>()
    const mainFrame = {}
    const page = {
      on: (event: string, handler: (...args: unknown[]) => void) =>
        pageHandlers.set(event, handler),
      off: (event: string) => pageHandlers.delete(event),
      mainFrame: () => mainFrame,
    }
    let releaseFirst: (() => void) | undefined
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const processed: number[] = []
    const stream = new PlaywrightCdpFrameStream({
      createSession: async () => session as never,
    })
    await stream.start({
      page: page as never,
      pageId: 'page-1',
      viewport: { width: 800, height: 600 },
      maxFrameRate: 30,
      sensitiveRegions: [],
      processFrame: async (frame) => {
        processed.push(frame.id)
        if (frame.id === 1) await firstBlocked
      },
      invalidate: () => undefined,
    })
    const emit = handlers.get('Page.screencastFrame')
    expect(emit).toBeTypeOf('function')
    for (let sessionId = 1; sessionId <= 3; sessionId += 1) {
      emit?.({
        data: 'YQ==',
        sessionId,
        metadata: { deviceWidth: 800, deviceHeight: 600 },
      })
    }
    expect(stream.metrics()).toMatchObject({
      framesReceived: 3,
      framesDropped: 1,
      maxPendingFrames: 1,
      pendingFrames: 1,
    })
    expect(sends.filter((call) => call.method === 'Page.screencastFrameAck')).toHaveLength(3)
    releaseFirst?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(processed).toEqual([1, 3])
    await stream.stop()
    expect(stream.metrics()).toMatchObject({ framesProcessed: 2, pendingFrames: 0, active: false })
  })
})
