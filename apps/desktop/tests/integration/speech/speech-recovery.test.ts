import assert from 'node:assert/strict'

import { afterEach, beforeEach, describe, it, vi } from 'vitest'

import type { Health } from '../../../src/main/speech/speechClient'
import { SpeechClient } from '../../../src/main/speech/speechClient'
import type { SpeechStreamOutput, SpeechStreamStart } from '../../../src/shared/speech'

class Socket extends EventTarget {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  binaryType = ''
  sent: unknown[] = []

  constructor() {
    super()
    Socket.instances.push(this)
  }

  open(): void {
    this.readyState = Socket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  send(value: string): void {
    const message = JSON.parse(value)
    this.sent.push(message)
    if (message.type === 'cancel')
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({ type: 'cancelled', sessionId: 'speech:test' }),
          }),
        ),
      )
  }

  close(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

const input: SpeechStreamStart = {
  protocolVersion: 2,
  sessionId: 'speech:test',
  turnId: 'test',
  voiceId: 'animevox_makima',
  language: 'ru',
  delivery: { emotion: 'neutral', pace: 'normal', energy: 'normal', volume: 'normal' },
}

function health(status: string): Health {
  return {
    status: 'ok',
    serviceId: 'shio.speech-api',
    contractVersion: '2.1',
    synthesis: { status, engine: 'fish-s2-pro', streaming: true },
  }
}

let client: SpeechClient
beforeEach(() => {
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  client = new SpeechClient('http://127.0.0.1:8000')
})
afterEach(() => {
  client.dispose()
})

async function cancelStartedStream(): Promise<void> {
  const connection = client.openStream(input, () => undefined)
  Socket.instances[0].open()
  await connection.cancel('interrupted')
}

describe('Fish recovery readiness after actual inference cancellation', () => {
  it('opens one new stream only after warming completes and sends queued text once', async () => {
    const probe = vi
      .spyOn(client, 'health')
      .mockResolvedValueOnce(health('warming'))
      .mockResolvedValueOnce(health('loading'))
      .mockResolvedValue(health('ready'))
    await cancelStartedStream()
    assert.equal(probe.mock.calls.length, 0)
    const connection = client.openStream(input, () => undefined)
    connection.send({ type: 'text', sequence: 0, text: 'Новая реплика.' })
    await new Promise((resolve) => setTimeout(resolve, 550))
    assert.equal(Socket.instances.length, 1)
    await vi.waitUntil(() => Socket.instances.length === 2, { timeout: 3000 })
    assert.equal(Socket.instances.length, 2)
    Socket.instances[1].open()
    assert.deepEqual(Socket.instances[1].sent, [
      { type: 'start', ...input },
      { type: 'text', sequence: 0, text: 'Новая реплика.' },
    ])
  })

  it('cancels a waiting turn without starting inference or consuming its text', async () => {
    vi.spyOn(client, 'health').mockResolvedValue(health('warming'))
    await cancelStartedStream()
    const events: SpeechStreamOutput[] = []
    const waiting = client.openStream(input, (event) => events.push(event))
    waiting.send({ type: 'text', sequence: 0, text: 'Не произносить.' })
    await waiting.cancel('cancel while waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(Socket.instances.length, 1)
    assert.deepEqual(events, [{ type: 'cancelled', sessionId: input.sessionId }])
  })

  it('reports failed readiness once without retrying a synthesis request', async () => {
    vi.spyOn(client, 'health').mockResolvedValue(health('failed'))
    await cancelStartedStream()
    const events: SpeechStreamOutput[] = []
    client.openStream(input, (event) => events.push(event))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(Socket.instances.length, 1)
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'error')
    assert(events[0].type === 'error' && events[0].code === 'synthesis_recovery_failed')
  })

  it('aborts readiness HTTP work on disposal and never opens a late socket', async () => {
    await cancelStartedStream()
    let requestSignal: AbortSignal | undefined
    vi.spyOn(client, 'health').mockImplementation(
      (signal) =>
        new Promise((_resolve, reject) => {
          requestSignal = signal
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
    )
    const events: SpeechStreamOutput[] = []
    client.openStream(input, (event) => events.push(event))
    client.dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(requestSignal?.aborted, true)
    assert.equal(Socket.instances.length, 1)
    assert.deepEqual(events, [{ type: 'cancelled', sessionId: input.sessionId }])
  })

  it('reports the bounded readiness deadline without starting synthesis', async () => {
    await cancelStartedStream()
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    vi.spyOn(client, 'health').mockResolvedValue(health('warming'))
    const events: SpeechStreamOutput[] = []
    client.openStream(input, (event) => events.push(event))
    await new Promise((resolve) => setTimeout(resolve, 10))
    deadline.abort(new Error('readiness deadline'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(timeout.mock.calls[0][0], 120_000)
    assert.equal(Socket.instances.length, 1)
    assert.equal(events.length, 1)
    assert(events[0].type === 'error' && events[0].code === 'synthesis_recovery_failed')
  })
})
