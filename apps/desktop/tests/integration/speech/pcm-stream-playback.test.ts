import assert from 'node:assert/strict'

import { afterEach, beforeEach, describe, it, vi } from 'vitest'

import { AudioPlayer, type PlaybackSession } from '../../../src/renderer/audio/audioPlayer'
import { createDeferred } from '../../support/Deferred'
import { installAudioEnvironment } from '../../support/speech/audioEnvironment'

let environment: ReturnType<typeof installAudioEnvironment>

const players: AudioPlayer[] = []

function createPlayer(): AudioPlayer {
  const player = new AudioPlayer()
  players.push(player)
  return player
}

beforeEach(() => {
  environment = installAudioEnvironment()
})

afterEach(async () => {
  for (const player of players.splice(0)) await player.dispose()
  assert.ok(environment.contexts.every((context) => context.state === 'closed'))
  assert.ok(environment.worklets.every((node) => !node.connected && node.port.onmessage === null))
  vi.unstubAllGlobals()
})

async function boundedBufferAndSynchronousCancellation(): Promise<void> {
  const player = createPlayer()
  const playback = await player.startPcmStream(10, {
    turnId: 'turn:pcm',
    onReady: () => undefined,
  })
  const node = environment.worklets[0]
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
  const player = createPlayer()
  const playback = await player.startPcmStream(10, {
    turnId: 'turn:oversized-pcm',
    onReady: () => undefined,
  })
  const node = environment.worklets[0]
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
  const player = createPlayer()
  const sessions: PlaybackSession[] = []
  const ready = createDeferred<void>()
  const playback = await player.startPcmStream(100, {
    turnId: 'turn:adaptive-pcm',
    onReady: (value) => {
      sessions.push(value)
      ready.resolve()
    },
  })
  const node = environment.worklets[0]
  assert.ok(node)

  await playback.append(new Float32Array(100).fill(0.2).buffer)
  assert.equal(sessions.length, 0, 'buffering alone must not announce audible playback')
  node.port.emit({ type: 'started' })
  await ready.promise
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
  it('advances the source clock only from audible position, holds on underrun and completes exactly', async () => {
    const player = createPlayer()
    const started = createDeferred<void>()
    const playback = await player.startPcmStream(100, {
      turnId: 'clock',
      onReady: () => undefined,
      onStarted: () => started.resolve(),
    })
    const node = environment.worklets[0]
    await playback.append(new Float32Array(100).buffer)
    assert.equal(player.getPcmClock()?.state, 'buffering')
    node.port.emit({ type: 'started' })
    await started.promise
    node.port.emit({ type: 'consumed', samples: 40 })
    assert.equal(
      player.getPcmClock()?.sourceSampleOffset,
      0,
      'transport credit is not audible time',
    )
    node.port.emit({ type: 'position', sampleOffset: 40 })
    assert.equal(player.getPcmClock()?.sourceSampleOffset, 40)
    node.port.emit({ type: 'underrun' })
    assert.equal(player.getPcmClock()?.state, 'buffering')
    assert.equal(player.getPcmClock()?.sourceSampleOffset, 40)
    node.port.emit({ type: 'position', sampleOffset: 60 })
    assert.equal(player.getPcmClock()?.state, 'playing')
    const completion = playback.finish()
    node.port.emit({ type: 'ended' })
    await completion
    assert.equal(player.getPcmClock()?.state, 'ended')
    assert.equal(player.getPcmClock()?.sourceSampleOffset, 100)
    assert.equal(player.isBusy(), false)
  })

  it('ignores a queued worklet event after cancellation and replacement', async () => {
    const player = createPlayer()
    const first = await player.startPcmStream(100, { turnId: 'first', onReady: () => undefined })
    const staleListener = environment.worklets[0].port.onmessage
    assert.ok(staleListener)
    const completion = first.finish()
    first.cancel('conversation-interrupted')
    await completion
    const second = await player.startPcmStream(100, { turnId: 'second', onReady: () => undefined })
    const clock = player.getPcmClock()
    for (const data of [
      { type: 'position', sampleOffset: 99 },
      { type: 'ended' },
      { type: 'error' },
    ])
      staleListener({ data } as MessageEvent<unknown>)
    assert.deepEqual(player.getPcmClock(), clock)
    assert.equal(player.getPlaybackDebug().turnId, 'second')
    assert.equal(first.session.getPcmPosition?.(), null)
    second.cancel('conversation-interrupted')
  })

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
