// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'

import { controller } from '../../src/renderer/Controller'
import { WatchPlaybackSpeech } from '../../src/renderer/runtime/WatchPlaybackSpeech'
import { WatchTogetherCapture } from '../../src/renderer/runtime/WatchTogetherCapture'
import { watchDetailRegions } from '../../src/renderer/runtime/watchDetailRegions'
import {
  WATCH_FRAME_WIDTH,
  WATCH_TURN_MAX_BYTES,
  type WatchMoment,
} from '../../src/shared/watchTogether'

vi.mock('../../src/renderer/Controller', () => ({
  controller: {
    getState: () => ({ status: 'idle', continuousListening: { microphoneCaptured: true } }),
    onWatchSpeech: () => () => undefined,
    subscribe: () => () => undefined,
    refreshOverlayVisibility: async () => undefined,
    setWatchViewing: vi.fn(),
    setWatchMicrophone: vi.fn(async () => undefined),
  },
}))

let capture: WatchTogetherCapture | undefined

afterEach(() => {
  capture?.stop()
  capture = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function share(width = 1920, height = 1080) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const scene = { value: 10, changedPixels: 48 * 27 }
  const detail: number[] = []
  const draws: { value: number; size: number[]; destination: number[]; video: boolean }[] = []
  const thumbnails: number[] = []
  const sheets: number[][] = []
  const frames = new WeakMap<HTMLCanvasElement, number>()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const canvas = this
    return {
      canvas,
      clearRect: () => undefined,
      drawImage(source: HTMLVideoElement | HTMLCanvasElement, ...destination: number[]) {
        const value = source instanceof HTMLVideoElement ? scene.value : frames.get(source)
        if (value === undefined) throw new Error('Empty frame')
        draws.push({
          value,
          size: [canvas.width, canvas.height],
          destination,
          video: source instanceof HTMLVideoElement,
        })
        frames.set(canvas, value)
        if (canvas.width === 48) thumbnails.push(value)
        if (canvas.width === WATCH_FRAME_WIDTH) detail.push(value)
        if (canvas.width === WATCH_FRAME_WIDTH * 2) {
          if (destination[0] === 0) sheets.push([value])
          else sheets.at(-1)?.push(value)
        }
      },
      getImageData() {
        const data = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(10)
        data.fill(scene.value, 0, scene.changedPixels * 4)
        return { data, width: canvas.width, height: canvas.height }
      },
    } as unknown as CanvasRenderingContext2D
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
    done({ size: 128, arrayBuffer: async () => new ArrayBuffer(128) } as Blob),
  )
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(width)
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(height)
  const track = Object.assign(new EventTarget(), { stop: vi.fn() })
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  }
  vi.stubGlobal('MediaStream', class {})
  const getDisplayMedia = vi.fn(async () => stream)
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
  const observe = vi.fn(async (_moment: WatchMoment) => ({ kind: 'quiet' }))
  const prepareTurn = vi.fn(async () => undefined)
  vi.stubGlobal('api', {
    watchTogether: {
      start: async () => ({ kind: 'started', id: 'test' }),
      stop: async () => undefined,
      onStopped: () => () => undefined,
      observe,
      prepareTurn,
    },
  })
  const ended = vi.fn()
  const onMicrophoneStatus = vi.fn()
  capture = new WatchTogetherCapture(ended, vi.fn(), vi.fn(), undefined, onMicrophoneStatus)
  await capture.start('test-window')
  expect(ended).not.toHaveBeenCalled()
  const prepare = vi.mocked(controller.setWatchViewing).mock.calls[0][1]
  if (!prepare) throw new Error('Missing capture callback')
  return {
    scene,
    thumbnails,
    detail,
    sheets,
    draws,
    observe,
    prepareTurn,
    prepare,
    getDisplayMedia,
    capture,
    track,
    onMicrophoneStatus,
  }
}

it('toggles the watch microphone without stopping or reacquiring the selected video', async () => {
  const { capture, getDisplayMedia, track, onMicrophoneStatus } = await share()
  await capture.setMicrophone(true)
  expect(onMicrophoneStatus.mock.calls.flat()).toEqual(['starting', 'on'])
  await capture.setMicrophone(false)
  expect(onMicrophoneStatus.mock.calls.flat()).toEqual(['starting', 'on', 'stopping', 'off'])
  expect(controller.setWatchMicrophone).toHaveBeenLastCalledWith('test', false)
  expect(controller.setWatchViewing).toHaveBeenCalledOnce()
  expect(getDisplayMedia).toHaveBeenCalledOnce()
  expect(track.stop).not.toHaveBeenCalled()
  await capture.setMicrophone(true)
  capture.stop()
  expect(controller.setWatchMicrophone).toHaveBeenLastCalledWith('test', false)
  expect(track.stop).toHaveBeenCalledOnce()
})

it('cancels a pending watch microphone start and ignores its late result', async () => {
  const { capture, onMicrophoneStatus } = await share()
  const delayed = Promise.withResolvers<undefined>()
  const request = vi.mocked(controller.setWatchMicrophone)
  request.mockReturnValueOnce(delayed.promise)
  const start = capture.setMicrophone(true)
  const signal = request.mock.calls[0][2]
  const stop = capture.setMicrophone(false)
  expect(signal?.aborted).toBe(true)
  expect(request).toHaveBeenLastCalledWith('test', false)
  await capture.setMicrophone(true)
  expect(request).toHaveBeenCalledTimes(2)
  delayed.resolve(undefined)
  await Promise.all([start, stop])
  expect(onMicrophoneStatus.mock.calls.flat()).toEqual(['starting', 'stopping', 'off'])
  await capture.setMicrophone(true)
  expect(onMicrophoneStatus).toHaveBeenLastCalledWith('on')
})

it('rolls back a cancelled or failed microphone start and leaves the live share available', async () => {
  const { capture, track, onMicrophoneStatus } = await share()
  const request = vi.mocked(controller.setWatchMicrophone)
  request.mockResolvedValueOnce('cancelled')
  await capture.setMicrophone(true)
  expect(onMicrophoneStatus).toHaveBeenLastCalledWith('off')
  request.mockRejectedValueOnce(new Error('Speech service unavailable'))
  await capture.setMicrophone(true)
  expect(onMicrophoneStatus).toHaveBeenLastCalledWith('failed')
  expect(track.stop).not.toHaveBeenCalled()
  await capture.setMicrophone(true)
  expect(onMicrophoneStatus).toHaveBeenLastCalledWith('on')
})

it('samples every 400 ms for a static minute with a single detailed frame and observation', async () => {
  const { thumbnails, detail, sheets, observe } = await share()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(thumbnails).toHaveLength(150)
  expect(detail).toEqual([10])
  expect(sheets).toEqual([[10, 10]])
  expect(observe).toHaveBeenCalledOnce()
  expect(observe.mock.calls[0][0].details).toHaveLength(2)
  expect(controller.setWatchMicrophone).not.toHaveBeenCalled()
})

it('sends current detail crops when only the playback transcript changes', async () => {
  const { observe, sheets } = await share()
  await vi.advanceTimersByTimeAsync(400)
  vi.spyOn(WatchPlaybackSpeech.prototype, 'observations').mockReturnValue([
    { startMs: -600, endMs: -100, text: 'Смотри на подпись.', final: true },
  ])
  await vi.advanceTimersByTimeAsync(4000)
  expect(sheets).toEqual([
    [10, 10],
    [10, 10],
  ])
  expect(observe.mock.calls.map(([moment]) => moment.details?.length)).toEqual([2, 2])
})

it('prioritizes thin high-contrast strokes in a native crop and keeps a separate region', () => {
  const width = 240,
    height = 135
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let y = 8; y < 16; y++) {
    for (let x = 215; x < 232; x += 2) {
      data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3)
    }
  }
  const [best, next] = watchDetailRegions({ width, height, data, colorSpace: 'srgb' }, 1920, 1080)
  expect(best).toMatchObject({ width: 960, height: 640 })
  expect(best.x).toBeGreaterThan(1920 / 3)
  expect(best.y).toBeLessThan(100)
  expect(next.x).not.toBe(best.x)
})

it('submits the current settled frame once when a slow observation outlives a small transition', async () => {
  const { scene, sheets, observe } = await share()
  const pending = Promise.withResolvers<{ kind: string }>()
  observe.mockReturnValueOnce(pending.promise)
  await vi.advanceTimersByTimeAsync(400)
  scene.changedPixels = 8
  scene.value = 90
  await vi.advanceTimersByTimeAsync(10_000)
  expect(observe).toHaveBeenCalledOnce()
  pending.resolve({ kind: 'quiet' })
  await vi.advanceTimersByTimeAsync(400)
  expect(sheets).toEqual([
    [10, 10],
    [90, 90],
  ])
  expect(observe.mock.lastCall?.[0].endedAt).toBe(Date.now())
  expect(observe.mock.lastCall?.[0].details).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(observe).toHaveBeenCalledTimes(2)
})

it.each([
  { sequence: [90], expected: [10, 90] },
  { sequence: [90, 10], expected: [90, 10] },
  { sequence: [90, 120, 90], expected: [120, 90] },
  { sequence: [15, 20, 25, 30], expected: [10, 30] },
])(
  'keeps the transition and the current frame across cooldown for $sequence',
  async ({ sequence, expected }) => {
    const { scene, sheets } = await share()
    await vi.advanceTimersByTimeAsync(400)
    for (const value of sequence) {
      scene.value = value
      await vi.advanceTimersByTimeAsync(400)
    }
    await vi.advanceTimersByTimeAsync(4000)
    expect(sheets).toEqual([[10, 10], expected])
  },
)

it('captures a fresh detailed frame for a microphone question even for a subthreshold change', async () => {
  const { scene, detail, draws, prepareTurn, prepare } = await share()
  await vi.advanceTimersByTimeAsync(400)
  scene.value = 11
  await vi.advanceTimersByTimeAsync(400)
  await prepare('question', true)
  expect(detail).toEqual([10])
  expect(draws.at(-1)).toEqual({
    value: 11,
    size: [1920, 1080],
    destination: [0, 0, 1920, 1080],
    video: true,
  })
  expect(prepareTurn).toHaveBeenCalledWith('test', 'question', true, expect.any(ArrayBuffer), '')
})

it.each([
  [3840, 2160, 3840, 2160],
  [2160, 3840, 2160, 3840],
  [288, 640, 288, 640],
  [7680, 2160, 3840, 1080],
  [4096, 4096, 2880, 2880],
])('fits a %i×%i source without padding or enlargement', async (w, h, outW, outH) => {
  const { prepare, draws, getDisplayMedia } = await share(w, h)
  await prepare('typed-question', false)
  expect(draws).toEqual([
    { value: 10, size: [outW, outH], destination: [0, 0, outW, outH], video: true },
  ])
  expect(getDisplayMedia).toHaveBeenCalledWith({
    video: { resizeMode: 'none' },
    audio: { restrictOwnAudio: true },
  })
})

it.each([true, false])(
  'shrinks the same captured image within four encodes (fits: %s)',
  async (fits) => {
    const { scene, draws, prepare, prepareTurn } = await share(3840, 2160)
    const bytes = new ArrayBuffer(256)
    const attempts: number[] = []
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((done, mime, quality) => {
      expect(mime).toBe('image/jpeg')
      attempts.push(Number(quality))
      scene.value++
      done({
        size: fits && attempts.length === 4 ? bytes.byteLength : WATCH_TURN_MAX_BYTES + 1,
        arrayBuffer: async () => bytes,
      } as Blob)
    })
    await prepare('question', true)
    expect(attempts).toHaveLength(4)
    expect(draws).toEqual([
      { value: 10, size: [3840, 2160], destination: [0, 0, 3840, 2160], video: true },
      { value: 10, size: [2496, 1404], destination: [0, 0, 2496, 1404], video: false },
    ])
    expect(prepareTurn).toHaveBeenCalledWith('test', 'question', true, fits ? bytes : undefined, '')
  },
)
