import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const { accentAlignment, heightByEmotion, longestQuiet, peakIndices, tempoByGroup } = createRequire(
  import.meta.url,
)('../../../qualifications/speech-motion/gesture-coverage.cjs')

const RATE = 44100

/** Summary-layout frame: hips, left hand, right hand, head positions. */
function frame(
  at: number,
  options: {
    leftY?: number
    rightY?: number
    headX?: number
    playing?: boolean
    emotion?: string | null
    accents?: number[]
  } = {},
) {
  return {
    at,
    positions: [
      0,
      1,
      0,
      0.2,
      1 + (options.leftY ?? -0.3),
      0.1,
      -0.2,
      1 + (options.rightY ?? -0.3),
      0.1,
      options.headX ?? 0,
      1.6,
      0,
    ],
    pcm: options.playing
      ? {
          state: 'playing',
          playbackId: 'p',
          sourceSampleRate: RATE,
          sourceSampleOffset: Math.round((at / 1000) * RATE),
        }
      : null,
    deliveryEmotion: options.emotion ?? null,
    accents: options.accents ?? [],
  }
}

const excursion = (value: { positions: number[] }) => value.positions[7] - value.positions[1] + 0.3

describe('liveliness metrics', () => {
  it('measures median wrist height per audible delivery emotion (M2)', () => {
    const frames = [
      ...Array.from({ length: 10 }, (_, index) =>
        frame(index * 33, { playing: true, emotion: 'happy', rightY: 0.05 }),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        frame(400 + index * 33, { playing: true, emotion: 'sad', rightY: -0.05 }),
      ),
      frame(900, { emotion: 'happy', rightY: 0.5 }),
    ]
    const heights = heightByEmotion(frames)
    expect(heights.happy - heights.sad).toBeCloseTo(10, 5)
  })

  it('finds prominent excursion peaks only', () => {
    expect(peakIndices([0, 0.05, 0, 0.05, 0])).toEqual([1, 3])
    expect(peakIndices([0, 0.01, 0, 0.01, 0])).toEqual([])
  })

  it('compares beat tempo of energetic and calm delivery (M3)', () => {
    const wave = (start: number, period: number, emotion: string) =>
      Array.from({ length: 120 }, (_, index) => {
        const at = start + index * 33
        return frame(at, {
          playing: true,
          emotion,
          rightY: -0.3 + 0.1 * Math.max(0, Math.sin((2 * Math.PI * (at - start)) / period)),
        })
      })
    const tempo = tempoByGroup(
      [...wave(0, 500, 'excited'), ...wave(10_000, 1_000, 'calm')],
      excursion,
    )
    expect(tempo.energeticPerSecond).toBeGreaterThan(tempo.calmPerSecond)
    expect(tempo.ratio).toBeGreaterThan(1.2)
  })

  it('counts beat endpoints aligned with a consumed accent within 120 ms (M4)', () => {
    const accents = [Math.round(0.5 * RATE), Math.round(2.0 * RATE)]
    const frames = Array.from({ length: 90 }, (_, index) => {
      const at = index * 33
      const peak = (center: number) => Math.max(0, 0.1 - Math.abs(at - center) / 2_000)
      return frame(at, { playing: true, accents, rightY: -0.3 + peak(500) + peak(1_400) })
    })
    const result = accentAlignment(frames, excursion)
    expect(result.beats).toBe(2)
    expect(result.aligned).toBe(1)
    expect(result.share).toBe(0.5)
  })

  it('reports the longest idle stretch without a visible hand or head action (M7)', () => {
    const frames = Array.from({ length: 1_200 }, (_, index) => {
      const at = index * 50
      // Head glances at 10 s and 40 s; otherwise still.
      const headX = (at >= 10_000 && at < 11_000) || (at >= 40_000 && at < 41_000) ? 0.05 : 0
      return frame(at, { headX })
    })
    const quiet = longestQuiet(frames)
    expect(quiet.seconds).toBeGreaterThan(28)
    expect(quiet.seconds).toBeLessThan(31)
    expect(quiet.actions).toBeGreaterThanOrEqual(2)
  })
})
