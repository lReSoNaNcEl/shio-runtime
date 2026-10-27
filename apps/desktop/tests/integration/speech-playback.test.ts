import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AudioPlayer } from '../../src/renderer/audio/audioPlayer'
import { createDeferred } from '../support/Deferred'
import { createAudioBuffer, installAudioEnvironment } from '../support/speech/audioEnvironment'

let environment: ReturnType<typeof installAudioEnvironment>
let player: AudioPlayer

beforeEach(() => {
  environment = installAudioEnvironment()
  player = new AudioPlayer()
})

afterEach(async () => {
  await player.dispose()
  expect(environment.intervals.size).toBe(0)
  expect(environment.contexts.every((context) => context.state === 'closed')).toBe(true)
  expect(environment.sources.every((source) => !source.connected && !source.onended)).toBe(true)
  vi.unstubAllGlobals()
})

async function start(turnId: string) {
  const started = createDeferred<void>()
  const onReady = vi.fn()
  const onProgress = vi.fn()
  const completion = player.play(new ArrayBuffer(44), {
    turnId,
    onReady,
    onProgress,
    onStarted: () => started.resolve(),
  })
  await started.promise
  const source = environment.sources.at(-1)
  if (!source) throw new Error('Playback started without an audio source')
  return { completion, onReady, onProgress, source }
}

describe('speech playback lifecycle', () => {
  it('finishes normal playback only after its source ends and releases the audio graph', async () => {
    const playback = await start('normal')
    expect(playback.onReady).toHaveBeenCalledOnce()
    expect(playback.onProgress.mock.calls).toEqual([[0]])
    expect(player.isPlaying()).toBe(true)
    expect(environment.intervals.size).toBe(1)
    playback.source.end()
    await expect(playback.completion).resolves.toMatchObject({ turnId: 'normal' })
    expect(playback.onProgress.mock.calls).toEqual([[0], [1]])
    expect(player.isBusy()).toBe(false)
    expect(playback.source.connected).toBe(false)
    expect(environment.intervals.size).toBe(0)
  })

  it('ignores an already queued ended callback from interrupted speech while its successor plays', async () => {
    const first = await start('first')
    // Retain the callback as if the audio thread had already queued it before stop().
    const staleEnded = first.source.onended
    if (!staleEnded) throw new Error('Active source has no completion callback')
    player.stopCurrent('first', 'conversation-interrupted')
    await first.completion
    expect(first.onProgress.mock.calls).toEqual([[0]])
    const second = await start('second')
    staleEnded()
    expect(player.getPlaybackDebug()).toMatchObject({ turnId: 'second', playing: true })
    expect(second.onProgress.mock.calls).toEqual([[0]])
    expect(first.onProgress.mock.calls).toEqual([[0]])
    second.source.end()
    await second.completion
    expect(second.onProgress.mock.calls).toEqual([[0], [1]])
  })

  it('stops manually and releases its timer without reporting natural completion', async () => {
    const playback = await start('manual-stop')
    player.stop()
    player.stop()
    await playback.completion
    expect(playback.source.stopped).toBe(true)
    expect(playback.source.onended).toBeNull()
    expect(playback.onProgress.mock.calls).toEqual([[0]])
    expect(player.isBusy()).toBe(false)
    expect(environment.intervals.size).toBe(0)
  })

  it('gives consecutive playback distinct ownership and one completion each', async () => {
    const first = await start('consecutive')
    first.source.end()
    const firstResult = await first.completion
    const second = await start('consecutive')
    second.source.end()
    const secondResult = await second.completion
    expect(secondResult.playbackId).not.toBe(firstResult.playbackId)
    expect(first.onReady).toHaveBeenCalledOnce()
    expect(second.onReady).toHaveBeenCalledOnce()
    expect(first.onProgress.mock.calls).toEqual([[0], [1]])
    expect(second.onProgress.mock.calls).toEqual([[0], [1]])
  })

  it('invalidates a pending decode before it can create a stale source', async () => {
    const decode = createDeferred<AudioBuffer>()
    environment.contexts[0].decodeAudioData.mockReturnValueOnce(decode.promise)
    const onReady = vi.fn()
    const completion = player.play(new ArrayBuffer(44), { turnId: 'decode', onReady })
    const rejected = expect(completion).rejects.toThrow('Playback ownership lost')
    player.stop()
    decode.resolve(createAudioBuffer())
    await rejected
    expect(onReady).not.toHaveBeenCalled()
    expect(environment.sources).toHaveLength(0)
  })

  it('does not start a connected source after cancellation during readiness', async () => {
    const ready = createDeferred<void>()
    const attached = createDeferred<void>()
    const completion = player.play(new ArrayBuffer(44), {
      turnId: 'ready',
      onReady: () => {
        attached.resolve()
        return ready.promise
      },
    })
    const rejected = expect(completion).rejects.toThrow('Playback ownership lost')
    await attached.promise
    player.stop()
    ready.resolve()
    await rejected
    expect(environment.sources[0].started).toBe(false)
    expect(environment.intervals.size).toBe(0)
  })
})
