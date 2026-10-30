import { describe, expect, it } from 'vitest'

import { PcmEnergyTimeline } from '../../../src/renderer/audio/PcmEnergyTimeline'
import { BinPitchEstimator, PitchAccentTracker } from '../../../src/renderer/audio/PcmPitchAccent'

const RATE = 44100

function tone(segments: Array<{ hz: number; seconds: number; amplitude?: number }>) {
  const total = segments.reduce((sum, segment) => sum + Math.round(segment.seconds * RATE), 0)
  const pcm = new Float32Array(total)
  let offset = 0
  let phase = 0
  for (const { hz, seconds, amplitude = 0.3 } of segments) {
    for (let index = 0; index < Math.round(seconds * RATE); index++) {
      phase += (2 * Math.PI * hz) / RATE
      // Two harmonics keep the period unambiguous like voiced speech.
      pcm[offset++] = amplitude * (Math.sin(phase) * 0.7 + Math.sin(2 * phase) * 0.3)
    }
  }
  return pcm
}

describe('submitted PCM pitch accents', () => {
  it('estimates the fundamental of a voiced window', () => {
    const estimator = new BinPitchEstimator(RATE)
    estimator.begin()
    for (const sample of tone([{ hz: 210, seconds: 0.05 }])) estimator.push(sample)
    expect(estimator.estimate()).toBeGreaterThan(200)
    expect(estimator.estimate()).toBeLessThan(220)
  })

  it('reports silence and short windows as unvoiced', () => {
    const estimator = new BinPitchEstimator(RATE)
    estimator.begin()
    for (let index = 0; index < RATE * 0.05; index++) estimator.push(0)
    expect(estimator.estimate()).toBe(0)
    estimator.begin()
    for (const sample of tone([{ hz: 200, seconds: 0.01 }])) estimator.push(sample)
    expect(estimator.estimate()).toBe(0)
  })

  it('marks the bin after a pitch rise and nothing on a flat tone', () => {
    const rising = new PcmEnergyTimeline(RATE)
    const pcm = tone([
      { hz: 200, seconds: 0.6 },
      { hz: 320, seconds: 0.3 },
    ])
    rising.append(pcm, 0, pcm.length)
    rising.finish()
    const snapshot = rising.snapshot(RATE * 0.4, 0.12)
    expect(snapshot).toBeDefined()
    const accent = snapshot?.accent ?? []
    expect(accent.length).toBe(snapshot?.energy.length)
    const jumpBin = Math.round((RATE * 0.6 - (snapshot?.startSample ?? 0)) / (RATE / 20))
    const peak = accent.indexOf(Math.max(...accent))
    expect(Math.max(...accent)).toBeGreaterThan(0.3)
    expect(Math.abs(peak - jumpBin)).toBeLessThanOrEqual(1)
    expect(accent.slice(0, Math.max(0, jumpBin - 1)).every((value) => value === 0)).toBe(true)

    const flat = new PcmEnergyTimeline(RATE)
    const steady = tone([{ hz: 200, seconds: 1 }])
    flat.append(steady, 0, steady.length)
    flat.finish()
    expect(flat.snapshot(RATE * 0.2, 0.12)?.accent.every((value) => value === 0)).toBe(true)
  })

  it('keeps accents bounded and aligned with at most thirty energy bins', () => {
    const timeline = new PcmEnergyTimeline(RATE)
    const pcm = tone([
      { hz: 150, seconds: 0.5 },
      { hz: 400, seconds: 0.5, amplitude: 0.6 },
      { hz: 150, seconds: 1 },
    ])
    timeline.append(pcm, 0, pcm.length)
    const snapshot = timeline.snapshot(RATE * 0.2, 0.12)
    expect(snapshot?.accent.length).toBe(snapshot?.energy.length)
    expect(snapshot?.accent.length).toBeLessThanOrEqual(30)
    expect(snapshot?.accent.every((value) => value >= 0 && value <= 1)).toBe(true)
  })

  it('weights a pitch rise by a simultaneous energy rise', () => {
    const steady = new PitchAccentTracker()
    const louder = new PitchAccentTracker()
    for (const tracker of [steady, louder]) for (let bin = 0; bin < 6; bin++) tracker.next(200, 0.1)
    expect(louder.next(300, 0.2)).toBeGreaterThan(steady.next(300, 0.1))
    expect(new PitchAccentTracker().next(0, 0.1)).toBe(0)
  })

  it('stays within the analysis CPU budget of 0.3 ms per 10 ms of audio', () => {
    const pcm = tone([
      { hz: 180, seconds: 1 },
      { hz: 260, seconds: 1 },
    ])
    let best = Number.POSITIVE_INFINITY
    for (let run = 0; run < 3; run++) {
      const timeline = new PcmEnergyTimeline(RATE)
      const started = performance.now()
      timeline.append(pcm, 0, pcm.length)
      best = Math.min(best, performance.now() - started)
    }
    // 2 s of audio = 200 blocks of 10 ms.
    expect(best / 200).toBeLessThan(0.3)
  })
})
