import { afterEach, expect, it, vi } from 'vitest'

import { StreamingAsrClient } from '../../../src/renderer/speech/continuous-listening/StreamingAsrClient'

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = Socket.OPEN
  bufferedAmount = 0
  send = vi.fn()
  close = vi.fn()
  onopen?: () => void
  onmessage?: (message: { data: string }) => void
  constructor() {
    Socket.instances.push(this)
  }
  ready(): string {
    this.onopen?.()
    const { sessionId } = JSON.parse(this.send.mock.calls[0][0])
    this.onmessage?.({
      data: JSON.stringify({
        type: 'ready',
        protocolVersion: 1,
        acceptedSampleRate: 16_000,
        sessionId,
      }),
    })
    return sessionId
  }
}

afterEach(() => {
  Socket.instances.length = 0
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function connectedClient() {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('WebSocket', Socket)
  const handlers = { onAudioGap: vi.fn(), onEvent: vi.fn(), onState: vi.fn() }
  const client = new StreamingAsrClient(handlers)
  const connecting = client.connect('http://localhost:8000')
  await Promise.resolve()
  const socket = Socket.instances[0]
  const sessionId = socket.ready()
  await connecting
  return { client, socket, sessionId, handlers }
}

it.each(['capture', 'transport'] as const)(
  'rejects late finals and resumes with fresh audio after a %s gap',
  async (gap) => {
    const { client, socket, sessionId, handlers } = await connectedClient()
    expect(JSON.parse(socket.send.mock.calls[0][0]).language).toBe('auto')
    const oldMessage = socket.onmessage
    const frame = new ArrayBuffer(640)
    socket.bufferedAmount = 16_000 - frame.byteLength
    client.sendPcm(frame)
    expect(socket.send).toHaveBeenLastCalledWith(frame)
    socket.bufferedAmount = gap === 'capture' ? 0 : socket.bufferedAmount + 2
    expect(client.sendPcm(frame, gap === 'capture')).toBe(false)
    client.sendPcm(frame)
    expect(socket.send).toHaveBeenCalledTimes(2)
    expect(socket.close).toHaveBeenCalledOnce()
    expect(handlers.onAudioGap).toHaveBeenCalledOnce()
    expect(handlers.onState).toHaveBeenLastCalledWith('reconnecting')
    const final = {
      type: 'final',
      sessionId,
      segmentId: 'old',
      revision: 1,
      text: 'old',
      startMs: 0,
      endMs: 100,
      reason: 'disconnect',
    }
    oldMessage?.({ data: JSON.stringify(final) })
    expect(handlers.onEvent).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    const next = Socket.instances[1]
    const nextSession = next.ready()
    expect(JSON.parse(next.send.mock.calls[0][0]).language).toBe('auto')
    expect(nextSession).not.toBe(sessionId)
    expect(next.send).toHaveBeenCalledTimes(1)
    const fresh = new ArrayBuffer(320)
    client.sendPcm(fresh)
    expect(next.send).toHaveBeenLastCalledWith(fresh)
    next.onmessage?.({ data: JSON.stringify({ ...final, sessionId: nextSession, text: 'fresh' }) })
    expect(handlers.onEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ text: 'fresh' }),
    )
    await client.stop()
  },
)

it('stopping after overflow cancels reconnection and ignores later capture frames', async () => {
  const { client, handlers } = await connectedClient()
  client.sendPcm(new ArrayBuffer(16_002))
  await client.stop()
  client.sendPcm(new ArrayBuffer(640))
  await vi.advanceTimersByTimeAsync(20_000)
  expect(Socket.instances).toHaveLength(1)
  expect(handlers.onAudioGap).toHaveBeenCalledOnce()
  expect(handlers.onState).toHaveBeenLastCalledWith('idle')
})

it('releases the handshake timeout if stopped while the replacement socket is opening', async () => {
  const { client } = await connectedClient()
  client.sendPcm(new ArrayBuffer(16_002))
  await vi.advanceTimersByTimeAsync(500)
  expect(Socket.instances).toHaveLength(2)
  await client.stop()
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(Socket.instances).toHaveLength(2)
})
