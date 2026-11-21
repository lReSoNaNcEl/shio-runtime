import { afterEach, expect, it, vi } from 'vitest'

import { StreamingPcmCapture } from '../../../src/renderer/audio/StreamingPcmCapture'

afterEach(() => vi.unstubAllGlobals())

it('distinguishes the live track from the next selection, including the default alias', async () => {
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
  vi.stubGlobal(
    'AudioContext',
    class {
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
  vi.stubGlobal(
    'AudioWorkletNode',
    class extends Node {
      port = { onmessage: null }
    },
  )
  const capture = new StreamingPcmCapture()
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
