import assert from 'node:assert/strict'

import { describe, it, vi } from 'vitest'

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
    protocolVersion: 2,
    sessionId: 'speech:turn:preload-race',
    engine: 'fish-s2-pro',
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
  vi.stubGlobal('window', {
    api: { tts: { openStream: () => messagePort } },
  })
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
    protocolVersion: 2,
    sessionId: 'speech:turn:stale',
    engine: 'fish-s2-pro',
    sampleRate: 24000,
    channels: 1,
    sampleFormat: 'float32-le',
    modelId: 'model',
    modelRevision: 'revision',
    sourceRevision: 'source',
  })
  await Promise.resolve()
  messagePort.emit({
    type: 'audio',
    sessionId: 'speech:turn:stale',
    turnId: 'turn:stale',
    sequence: 0,
    sampleOffset: 0,
    samples: 1,
    pcm: new ArrayBuffer(4),
  })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(appended, 1)
  await vi.waitFor(() =>
    assert.deepEqual(messagePort.sent.at(-1), { type: 'audio-ack', sequence: 0 }),
  )

  stream.cancel('conversation-interrupted')
  messagePort.emit({
    type: 'audio',
    sessionId: 'speech:turn:stale',
    turnId: 'turn:stale',
    sequence: 1,
    sampleOffset: 1,
    samples: 1,
    pcm: new ArrayBuffer(4),
  })
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
  vi.stubGlobal('window', {
    api: { tts: { openStream: () => messagePort } },
  })
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
    voiceStyle: 'bright playful tone',
    sequence: 0,
    boundary: 'sentence',
  })
  stream.finish()

  assert.deepEqual(messagePort.sent, [])
  messagePort.emit({
    type: 'ready',
    protocolVersion: 2,
    sessionId: 'speech:turn:handshake',
    engine: 'fish-s2-pro',
    sampleRate: 24000,
    channels: 1,
    sampleFormat: 'float32-le',
    modelId: 'model',
    modelRevision: 'revision',
    sourceRevision: 'source',
  })

  assert.deepEqual(messagePort.sent, [
    { type: 'delivery', sequence: 0, delivery: deliveryIntent('happy', 'bright playful tone') },
    { type: 'text', sequence: 1, text: 'Готовый текст для проверки handshake.' },
    { type: 'finish-input' },
  ])
  const rejected = assert.rejects(stream.completion, /Speech stream cancelled/u)
  stream.cancel('conversation-interrupted')
  await rejected
}

function pendingConsumerFixture() {
  const messagePort = new FakeMessagePort()
  vi.stubGlobal('window', { api: { tts: { openStream: () => messagePort } } })
  const player = { stopCurrent: vi.fn() } as unknown as AudioPlayer
  const output = new RuntimeSpeechOutputPort(
    { hasSpeakableContent: () => true } as unknown as SpeechRuntime,
    player,
  )
  return {
    messagePort,
    stream: output.openStream('turn:pending-consumer', deliveryIntent('neutral'), {
      turnId: 'turn:pending-consumer',
      onReady: () => undefined,
    }),
  }
}

async function cancellationBeforeConsumerAwaits(kind: 'local' | 'server'): Promise<void> {
  const unhandled: unknown[] = []
  const observeUnhandled = (error: unknown): void => {
    unhandled.push(error)
  }
  const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  process.on('unhandledRejection', observeUnhandled)
  try {
    const { messagePort, stream } = pendingConsumerFixture()
    if (kind === 'local') stream.cancel('conversation-interrupted')
    else messagePort.emit({ type: 'cancelled', sessionId: 'speech:turn:pending-consumer' })
    // Generation can still be pending here: the completion consumer has not reached its await.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await assert.rejects(stream.completion, /Speech stream cancelled/u)
    assert.equal(unhandled.length, 0, 'expected cancellation escaped before its consumer awaited')
    assert.equal(
      report.mock.calls.length,
      0,
      'expected cancellation was reported as a provider error',
    )
  } finally {
    process.removeListener('unhandledRejection', observeUnhandled)
    report.mockRestore()
    vi.unstubAllGlobals()
  }
}

async function providerFailureRemainsObservable(): Promise<void> {
  const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const { messagePort, stream } = pendingConsumerFixture()
    const rejection = assert.rejects(stream.completion, /FISH_INFERENCE_FAILED: bounded failure/u)
    messagePort.emit({ type: 'error', code: 'FISH_INFERENCE_FAILED', message: 'bounded failure' })
    await rejection
    assert.equal(report.mock.calls.length, 1)
    assert.equal(report.mock.calls[0][0], '[SpeechOutput] stream failed')
    assert.match(String(report.mock.calls[0][1]), /FISH_INFERENCE_FAILED/u)
  } finally {
    report.mockRestore()
    vi.unstubAllGlobals()
  }
}

describe('renderer speech output stream', () => {
  it('contains local cancellation before generation reaches the completion await', () =>
    cancellationBeforeConsumerAwaits('local'))
  it('contains server cancellation before generation reaches the completion await', () =>
    cancellationBeforeConsumerAwaits('server'))
  it(
    'reports provider failures while preserving the original rejected completion',
    providerFailureRemainsObservable,
  )

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
