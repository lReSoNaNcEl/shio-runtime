import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { createSpeechStreamRendererPort } from '../../../src/preload/speechStreamPort'
import type {
  AudioPlayer,
  PcmStreamPlayback,
  PlaybackCompletion,
} from '../../../src/renderer/audio/audioPlayer'
import {
  deliveryIntent,
  RuntimeSpeechOutputPort,
} from '../../../src/renderer/runtime/SpeechOutputPort'
import type { SpeechRuntime } from '../../../src/renderer/runtime/SpeechRuntime'
import type { SpeechStreamInput, SpeechStreamOutput } from '../../../src/shared/speech'

class FakeMessagePort {
  readonly sent: SpeechStreamInput[] = []
  closed = false
  started = false
  private onMessage: ((message: SpeechStreamOutput) => void) | null = null

  postMessage(message: SpeechStreamInput): void {
    this.sent.push(message)
  }

  close(): void {
    this.closed = true
  }

  start(onMessage: (message: SpeechStreamOutput) => void, _onMessageError: () => void): void {
    this.started = true
    this.onMessage = onMessage
  }

  emit(message: SpeechStreamOutput): void {
    this.onMessage?.(message)
  }
}

class FakeNativeMessagePort {
  onmessage: ((event: MessageEvent<SpeechStreamOutput>) => void) | null = null
  onmessageerror: (() => void) | null = null
  readonly sent: SpeechStreamInput[] = []
  started = false
  closed = false

  postMessage(message: SpeechStreamInput): void {
    this.sent.push(message)
  }

  start(): void {
    this.started = true
  }

  close(): void {
    this.closed = true
  }

  emit(message: SpeechStreamOutput): void {
    this.onmessage?.({ data: message } as MessageEvent<SpeechStreamOutput>)
  }
}

function preloadRetainsReadyBeforeRendererSubscribes(): void {
  const nativePort = new FakeNativeMessagePort()
  const rendererPort = createSpeechStreamRendererPort(nativePort as unknown as MessagePort)
  const ready: SpeechStreamOutput = {
    type: 'ready',
    protocolVersion: 1,
    sessionId: 'speech:turn:preload-race',
    engine: 'cosyvoice3',
    sampleRate: 24000,
    channels: 1,
    sampleFormat: 'float32-le',
    modelId: 'model',
    modelRevision: 'revision',
    sourceRevision: 'source',
  }
  nativePort.emit(ready)

  const received: SpeechStreamOutput[] = []
  rendererPort.start(
    (output) => received.push(output),
    () => assert.fail('messageerror'),
  )

  assert.equal(nativePort.started, true)
  assert.deepEqual(received, [ready])
}

async function latePcmCannotResumeCancelledPlayback(): Promise<void> {
  const messagePort = new FakeMessagePort()
  let appended = 0
  let stopped = 0
  const playback: PcmStreamPlayback = {
    session: {
      playbackId: 'turn:stale:playback-1',
      playbackItemId: 'turn:stale:playback-1',
      turnId: 'turn:stale',
      analyser: {} as AnalyserNode,
      startedAt: 0,
      normalizationReference: 0.12,
      durationMs: 0,
    },
    append: async () => {
      appended += 1
    },
    finish: async (): Promise<PlaybackCompletion> => ({
      playbackId: 'turn:stale:playback-1',
      turnId: 'turn:stale',
    }),
    cancel: () => undefined,
  }
  const player = {
    startPcmStream: async () => playback,
    stopCurrent: () => {
      stopped += 1
    },
  } as unknown as AudioPlayer
  ;(globalThis as unknown as { window: unknown }).window = {
    api: { tts: { openStream: () => messagePort } },
  }
  const output = new RuntimeSpeechOutputPort(
    { hasSpeakableContent: () => true } as unknown as SpeechRuntime,
    player,
  )
  const stream = output.openStream('turn:stale', deliveryIntent('warm'), {
    turnId: 'turn:stale',
    onReady: () => undefined,
  })
  const rejected = assert.rejects(stream.completion, /Speech stream cancelled/u)
  messagePort.emit({
    type: 'ready',
    protocolVersion: 1,
    sessionId: 'speech:turn:stale',
    engine: 'cosyvoice3',
    sampleRate: 24000,
    channels: 1,
    sampleFormat: 'float32-le',
    modelId: 'model',
    modelRevision: 'revision',
    sourceRevision: 'source',
  })
  await Promise.resolve()
  messagePort.emit({ type: 'audio', sequence: 0, samples: 1, pcm: new ArrayBuffer(4) })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(appended, 1)
  assert.deepEqual(messagePort.sent.at(-1), { type: 'audio-ack', sequence: 0 })

  stream.cancel('conversation-interrupted')
  messagePort.emit({ type: 'audio', sequence: 1, samples: 1, pcm: new ArrayBuffer(4) })
  await Promise.resolve()

  assert.equal(stopped, 1)
  assert.equal(appended, 1)
  assert.equal(messagePort.closed, true)
  await rejected
}

async function textWaitsForServerReady(): Promise<void> {
  const messagePort = new FakeMessagePort()
  const playback: PcmStreamPlayback = {
    session: {
      playbackId: 'turn:handshake:playback-1',
      playbackItemId: 'turn:handshake:playback-1',
      turnId: 'turn:handshake',
      analyser: {} as AnalyserNode,
      startedAt: 0,
      normalizationReference: 0.12,
      durationMs: 0,
    },
    append: async () => undefined,
    finish: async () => ({
      playbackId: 'turn:handshake:playback-1',
      turnId: 'turn:handshake',
    }),
    cancel: () => undefined,
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    api: { tts: { openStream: () => messagePort } },
  }
  const output = new RuntimeSpeechOutputPort(
    { hasSpeakableContent: () => true } as unknown as SpeechRuntime,
    {
      startPcmStream: async () => playback,
      stopCurrent: () => undefined,
    } as unknown as AudioPlayer,
  )
  const stream = output.openStream('turn:handshake', deliveryIntent('neutral'), {
    turnId: 'turn:handshake',
    onReady: () => undefined,
  })
  assert.equal(messagePort.started, true)
  stream.commit({
    id: 'turn:handshake:speech:0',
    turnId: 'turn:handshake',
    text: 'Готовый текст для проверки handshake.',
    emotion: 'happy',
    sequence: 0,
    boundary: 'sentence',
  })
  stream.finish()

  assert.deepEqual(messagePort.sent, [])
  messagePort.emit({
    type: 'ready',
    protocolVersion: 1,
    sessionId: 'speech:turn:handshake',
    engine: 'cosyvoice3',
    sampleRate: 24000,
    channels: 1,
    sampleFormat: 'float32-le',
    modelId: 'model',
    modelRevision: 'revision',
    sourceRevision: 'source',
  })

  assert.deepEqual(messagePort.sent, [
    { type: 'delivery', sequence: 0, delivery: deliveryIntent('happy') },
    { type: 'text', sequence: 1, text: 'Готовый текст для проверки handshake.' },
    { type: 'finish-input' },
  ])
  const rejected = assert.rejects(stream.completion, /Speech stream cancelled/u)
  stream.cancel('conversation-interrupted')
  await rejected
}

describe('renderer speech output stream', () => {
  it(
    'retains a preload ready event until the renderer subscribes',
    preloadRetainsReadyBeforeRendererSubscribes,
  )
  it('queues text and finish until the server ready handshake', textWaitsForServerReady)
  it(
    'drops every late PCM packet after synchronous local cancellation',
    latePcmCannotResumeCancelledPlayback,
  )
})
