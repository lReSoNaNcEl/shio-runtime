import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { AudioPlayer, type PlaybackSession } from '../../../src/renderer/audio/audioPlayer'

class FakeAnalyser {
  fftSize = 0
  connect(): void {}
  disconnect(): void {}
}

class FakeWorkletPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  readonly sent: Array<{ type: string; pcm?: ArrayBuffer }> = []

  postMessage(message: { type: string; pcm?: ArrayBuffer }): void {
    this.sent.push(message)
  }

  emit(message: { type: string; samples?: number }): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>)
  }
}

const createdWorklets: FakeAudioWorkletNode[] = []

class FakeAudioWorkletNode {
  readonly port = new FakeWorkletPort()
  connected = false

  constructor() {
    createdWorklets.push(this)
  }

  connect(): void {
    this.connected = true
  }

  disconnect(): void {
    this.connected = false
  }
}

class FakeAudioContext {
  state = 'running'
  destination = {}
  audioWorklet = { addModule: async () => undefined }

  createAnalyser(): AnalyserNode {
    return new FakeAnalyser() as unknown as AnalyserNode
  }

  async resume(): Promise<void> {}

  async close(): Promise<void> {
    this.state = 'closed'
  }
}

async function boundedBufferAndSynchronousCancellation(): Promise<void> {
  createdWorklets.length = 0
  const globals = globalThis as unknown as Record<string, unknown>
  globals.AudioContext = FakeAudioContext
  globals.AudioWorkletNode = FakeAudioWorkletNode
  globals.window = { clearInterval: () => undefined }
  const player = new AudioPlayer()
  const playback = await player.startPcmStream(10, {
    turnId: 'turn:pcm',
    onReady: () => undefined,
  })
  const node = createdWorklets[0]
  assert.ok(node)

  await playback.append(new Float32Array(10).buffer)
  let secondAppendComplete = false
  const secondAppend = playback.append(new Float32Array(10).buffer).then(() => {
    secondAppendComplete = true
  })
  await Promise.resolve()
  assert.equal(secondAppendComplete, false)
  assert.equal(node.port.sent.filter((message) => message.type === 'push').length, 1)

  node.port.emit({ type: 'consumed', samples: 10 })
  await secondAppend
  assert.equal(node.port.sent.filter((message) => message.type === 'push').length, 2)

  const blockedAppend = playback.append(new Float32Array(10).buffer)
  await Promise.resolve()
  assert.equal(node.port.sent.filter((message) => message.type === 'push').length, 2)

  player.stopCurrent('turn:pcm', 'conversation-interrupted')
  assert.equal(player.isBusy(), false)
  assert.equal(node.connected, false)
  assert.equal(node.port.sent.at(-1)?.type, 'cancel')
  await assert.rejects(blockedAppend, /Playback ownership lost/u)
  await assert.rejects(playback.append(new Float32Array(1).buffer), /Playback ownership lost/u)
  await player.dispose()
}

async function oversizedProviderChunkIsReframedForBoundedPlayback(): Promise<void> {
  createdWorklets.length = 0
  const globals = globalThis as unknown as Record<string, unknown>
  globals.AudioContext = FakeAudioContext
  globals.AudioWorkletNode = FakeAudioWorkletNode
  globals.window = { clearInterval: () => undefined }
  const player = new AudioPlayer()
  const playback = await player.startPcmStream(10, {
    turnId: 'turn:oversized-pcm',
    onReady: () => undefined,
  })
  const node = createdWorklets[0]
  assert.ok(node)

  let appendComplete = false
  const append = playback.append(new Float32Array(31).buffer).then(() => {
    appendComplete = true
  })
  await Promise.resolve()
  await Promise.resolve()

  for (let index = 0; index < 3 && !appendComplete; index += 1) {
    node.port.emit({ type: 'consumed', samples: 7 })
    await Promise.resolve()
    await Promise.resolve()
  }
  await append

  const pushedSamples = node.port.sent
    .filter((message) => message.type === 'push')
    .map((message) => (message.pcm?.byteLength ?? 0) / Float32Array.BYTES_PER_ELEMENT)
  assert.deepEqual(pushedSamples, [7, 7, 7, 7, 3])
  assert.equal(appendComplete, true)

  player.stopCurrent('turn:oversized-pcm', 'conversation-interrupted')
  await player.dispose()
}

async function streamingSessionPublishesAdaptiveMetrics(): Promise<void> {
  createdWorklets.length = 0
  const globals = globalThis as unknown as Record<string, unknown>
  globals.AudioContext = FakeAudioContext
  globals.AudioWorkletNode = FakeAudioWorkletNode
  globals.window = { clearInterval: () => undefined }
  const player = new AudioPlayer()
  const sessions: PlaybackSession[] = []
  const playback = await player.startPcmStream(100, {
    turnId: 'turn:adaptive-pcm',
    onReady: (value) => {
      sessions.push(value)
    },
  })
  const node = createdWorklets[0]
  assert.ok(node)

  await playback.append(new Float32Array(100).fill(0.2).buffer)
  const session = sessions[0]
  assert.ok(session)
  assert.ok(Math.abs(session.normalizationReference - 0.2) < 0.001)
  assert.equal(session.durationMs, 1_000)
  assert.equal(session.durationFinal, false)

  const finish = playback.finish()
  assert.equal(session.durationFinal, true)
  node.port.emit({ type: 'ended' })
  await finish
  await player.dispose()
}

describe('PCM stream playback', () => {
  it(
    'bounds buffered PCM and synchronously invalidates playback ownership on cancel',
    boundedBufferAndSynchronousCancellation,
  )
  it('reframes a provider PCM chunk that exceeds the playback capacity', async () => {
    await oversizedProviderChunkIsReframedForBoundedPlayback()
  })
  it('publishes adaptive loudness and duration metrics for streamed PCM', async () => {
    await streamingSessionPublishesAdaptiveMetrics()
  })
})
