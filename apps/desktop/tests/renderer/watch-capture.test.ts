// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'

import { controller } from '../../src/renderer/Controller'
import { WatchTogetherCapture } from '../../src/renderer/runtime/WatchTogetherCapture'
import { WATCH_FRAME_WIDTH, type WatchMoment } from '../../src/shared/watchTogether'

vi.mock('../../src/renderer/Controller', () => ({
  controller: {
    getState: () => ({ status: 'idle', continuousListening: { microphoneCaptured: true } }),
    onWatchSpeech: () => () => undefined,
    subscribe: () => () => undefined,
    refreshOverlayVisibility: async () => undefined,
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

async function share() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const scene = { value: 10, changedPixels: 48 * 27 }
  const detail: number[] = []
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
      drawImage(source: HTMLVideoElement | HTMLCanvasElement, x: number) {
        const value = source instanceof HTMLVideoElement ? scene.value : frames.get(source)
        if (value === undefined) throw new Error('Empty frame')
        frames.set(canvas, value)
        if (canvas.width === 48) thumbnails.push(value)
        if (canvas.width === WATCH_FRAME_WIDTH) detail.push(value)
        if (canvas.width === WATCH_FRAME_WIDTH * 2) {
          if (x === 0) sheets.push([value])
          else sheets.at(-1)?.push(value)
        }
      },
      getImageData() {
        const data = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(10)
        data.fill(scene.value, 0, scene.changedPixels * 4)
        return { data }
      },
    } as unknown as CanvasRenderingContext2D
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
    done({ size: 128, arrayBuffer: async () => new ArrayBuffer(128) } as Blob),
  )
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1920)
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1080)
  const track = Object.assign(new EventTarget(), { stop: vi.fn() })
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  }
  vi.stubGlobal('MediaStream', class {})
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => stream } })
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
  capture = new WatchTogetherCapture(ended, vi.fn(), vi.fn())
  await capture.start('test-window')
  expect(ended).not.toHaveBeenCalled()
  return { scene, thumbnails, detail, sheets, observe, prepareTurn }
}

it('samples every 400 ms for a static minute with a single detailed frame and observation', async () => {
  const { thumbnails, detail, sheets, observe } = await share()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(thumbnails).toHaveLength(150)
  expect(detail).toEqual([10])
  expect(sheets).toEqual([[10, 10]])
  expect(observe).toHaveBeenCalledOnce()
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
  await vi.advanceTimersByTimeAsync(30_000)
  expect(observe).toHaveBeenCalledTimes(2)
})

it.each([
  { sequence: [90], expected: [10, 90] },
  { sequence: [90, 10], expected: [90, 10] },
  { sequence: [90, 120, 90], expected: [10, 90] },
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
  const { scene, detail, prepareTurn } = await share()
  await vi.advanceTimersByTimeAsync(400)
  scene.value = 11
  await vi.advanceTimersByTimeAsync(400)
  const prepare = vi.mocked(controller.setWatchMicrophone).mock.calls[0][3]
  expect(prepare).toBeTypeOf('function')
  await prepare?.('question', true)
  expect(detail).toEqual([10, 11])
  expect(prepareTurn).toHaveBeenCalledWith('test', 'question', true, expect.any(ArrayBuffer), '')
})
