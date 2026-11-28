import { afterEach, expect, it, vi } from 'vitest'

import {
  type CapturedPcmTiming,
  StreamingPcmCapture,
} from '../../../src/renderer/audio/StreamingPcmCapture'

afterEach(() => vi.unstubAllGlobals())

function microphone() {
  const track = {
    label: 'Studio mic',
    readyState: 'live',
    getSettings: () => ({ deviceId: 'studio' }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    stop: vi.fn(),
  }
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] }
  const getUserMedia = vi.fn(async () => stream)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  class Node {
    connect() {}
    disconnect() {}
  }
  const clock = { currentTime: 0 }
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = 48_000
      get currentTime() {
        return clock.currentTime
      }
      audioWorklet = { addModule: async () => undefined }
      createMediaStreamSource() {
        return new Node()
      }
      createGain() {
        return Object.assign(new Node(), { gain: { value: 1 } })
      }
      async close() {}
    },
  )
  const port = {
    onmessage: null as
      | null
      | ((event: { data: { startFrame: number; samples: Float32Array } }) => void),
    postMessage: vi.fn(),
    close: vi.fn(),
  }
  vi.stubGlobal(
    'AudioWorkletNode',
    class extends Node {
      port = port
    },
  )
  return { track, getUserMedia, capture: new StreamingPcmCapture(), port, clock }
}

it('distinguishes the live track from the next selection, including the default alias', async () => {
  const { track, capture, getUserMedia } = microphone()
  await capture.start('', () => undefined)
  expect(capture.activeMicrophone('default')).toEqual({ label: 'Studio mic', changePending: false })
  expect(capture.activeMicrophone('studio')?.changePending).toBe(false)
  expect(capture.activeMicrophone('headset')).toEqual({ label: 'Studio mic', changePending: true })
  expect(getUserMedia).toHaveBeenCalledOnce()
  track.readyState = 'ended'
  expect(capture.activeMicrophone('headset')).toBeUndefined()
  await capture.stop()
  expect(capture.activeMicrophone('headset')).toBeUndefined()
})

it('dates admitted PCM by the source clock and reports a skipped interval on the first fresh block only', async () => {
  const { capture, clock, port } = microphone()
  const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
  const frame = vi.fn<(pcm: ArrayBuffer, timing: CapturedPcmTiming) => void>()
  try {
    await capture.start('', frame)
    const deliver = (startFrame: number) =>
      port.onmessage?.({ data: { startFrame, samples: new Float32Array(960) } })
    clock.currentTime = 1.02
    deliver(0)
    expect(frame.mock.lastCall?.[1]).toEqual({ endedAt: 9000, discontinuous: false })
    clock.currentTime = 3.04
    deliver(960)
    expect(frame).toHaveBeenCalledOnce()
    deliver(48_000 * 3)
    expect(frame.mock.lastCall?.[1]).toEqual({ endedAt: 9980, discontinuous: true })
    deliver(48_000 * 3 + 960)
    expect(frame.mock.lastCall?.[1]).toEqual({ endedAt: 10_000, discontinuous: false })
    expect(port.postMessage).toHaveBeenCalledTimes(4)
  } finally {
    await capture.stop()
    now.mockRestore()
  }
  expect(port.onmessage).toBeNull()
  expect(port.close).toHaveBeenCalledOnce()
})
