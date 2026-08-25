import assert from 'node:assert/strict'

import {
  AgentBrowserRealtimeAdapter,
  BrowserRealtimeError,
} from '../../src/main/desktop-control/AgentBrowserRealtimeAdapter'
import type { BrowserSessionState } from '../../src/shared/desktop-control'

type SocketListener = (event: { data: unknown }) => void

class FakeStreamSocket {
  readyState = 0
  readonly sent: string[] = []
  readonly url: string
  private readonly listeners = new Map<string, Set<SocketListener>>()

  constructor(url: string) {
    this.url = url
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open')
    })
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: SocketListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    assert.equal(this.readyState, 1)
    this.sent.push(data)
  }

  close(): void {
    if (this.readyState >= 2) return
    this.readyState = 3
    this.emit('close')
  }

  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }
}

function jpeg(width: number, height: number): string {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ]).toString('base64')
}

function frame(seq: number, timestamp: number): string {
  return JSON.stringify({
    type: 'frame',
    seq,
    data: jpeg(640, 360),
    metadata: {
      deviceWidth: 1_280,
      deviceHeight: 720,
      pageScaleFactor: 1,
      timestamp,
    },
  })
}

function readySession(): BrowserSessionState {
  return {
    sessionId: 'browser-session-11111111-1111-4111-8111-111111111111',
    status: 'ready',
    currentUrl: 'https://game.example/play',
    activeTabId: 'tab-game',
    openedAt: 1_000,
    updatedAt: 1_000,
  }
}

async function main(): Promise<void> {
  let now = 10_000
  let session = readySession()
  let socket: FakeStreamSocket | undefined
  const commands: string[][] = []
  const adapter = new AgentBrowserRealtimeAdapter({
    session: () => ({ ...session }),
    now: () => now,
    runStreamCommand: async (args) => {
      commands.push([...args])
      return JSON.stringify({ success: true, data: { enabled: true, port: 43_210 } })
    },
    inspectGameSurfaces: async () => [
      {
        id: 'game-surface-0',
        kind: 'canvas',
        bounds: { x: 10, y: 20, width: 640, height: 360 },
      },
    ],
    createSocket: (url) => {
      socket = new FakeStreamSocket(url)
      return socket
    },
  })

  const binding = adapter.session()
  assert(binding)
  assert.equal(binding.origin, 'https://game.example')
  assert.equal((await adapter.inspectGameSurfaces(new AbortController().signal))[0]?.kind, 'canvas')
  const firstCapture = adapter.captureFrame(
    { sessionId: binding.sessionId, tabId: binding.tabId },
    new AbortController().signal,
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert(socket)
  assert.equal(socket.url, 'ws://127.0.0.1:43210/?pacing=ack&maxFps=10')
  assert.deepEqual(commands, [['stream', 'status']])
  socket.emit('message', frame(41, now))
  const captured = await firstCapture
  assert.equal(captured.frameId, 41)
  assert.equal(captured.width, 640)
  assert.equal(captured.height, 360)
  assert.deepEqual(captured.viewport, { width: 1_280, height: 720, pageScaleFactor: 1 })
  assert.deepEqual(JSON.parse(socket.sent[0] ?? ''), { type: 'ack', seq: 41 })

  const beforeInvalidBatch = socket.sent.length
  await assert.rejects(
    () =>
      adapter.dispatchInput(
        {
          sessionId: binding.sessionId,
          tabId: binding.tabId,
          events: [
            { type: 'pointer-down', x: 100, y: 120, button: 'left' },
            { type: 'pointer-move', x: 2_000, y: 10 },
          ],
        },
        new AbortController().signal,
      ),
    (error) => error instanceof BrowserRealtimeError && error.code === 'INVALID_INPUT',
  )
  assert.equal(socket.sent.length, beforeInvalidBatch)

  await adapter.dispatchInput(
    {
      sessionId: binding.sessionId,
      tabId: binding.tabId,
      events: [
        { type: 'pointer-down', x: 100, y: 120, button: 'left' },
        { type: 'pointer-move', x: 140, y: 160 },
        { type: 'key-down', key: 'w', code: 'KeyW', text: 'w' },
      ],
    },
    new AbortController().signal,
  )
  await adapter.releaseInputs()
  const sent = socket.sent.map((message) => JSON.parse(message) as Record<string, unknown>)
  assert(sent.some((message) => message.eventType === 'mousePressed'))
  assert(sent.some((message) => message.eventType === 'keyDown'))
  assert(sent.some((message) => message.eventType === 'mouseReleased'))
  assert(sent.some((message) => message.eventType === 'keyUp'))
  assert(
    sent.some(
      (message) => message.eventType === 'mouseReleased' && message.x === 140 && message.y === 160,
    ),
  )

  await assert.rejects(
    () =>
      adapter.dispatchInput(
        {
          sessionId: binding.sessionId,
          tabId: binding.tabId,
          events: [{ type: 'pointer-move', x: 2_000, y: 10 }],
        },
        new AbortController().signal,
      ),
    (error) => error instanceof BrowserRealtimeError && error.code === 'INVALID_INPUT',
  )

  now += 100
  session = { ...session, activeTabId: 'tab-other', updatedAt: now }
  await assert.rejects(
    () =>
      adapter.dispatchInput(
        {
          sessionId: binding.sessionId,
          tabId: binding.tabId,
          events: [{ type: 'key-down', key: 'a' }],
        },
        new AbortController().signal,
      ),
    (error) => error instanceof BrowserRealtimeError && error.code === 'SESSION_MISMATCH',
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(socket.readyState, 3)

  console.log('browser realtime repro passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
