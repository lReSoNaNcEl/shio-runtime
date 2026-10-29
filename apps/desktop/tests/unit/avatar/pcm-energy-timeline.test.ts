import { describe, expect, it } from 'vitest'

import { PcmEnergyTimeline } from '../../../src/renderer/audio/PcmEnergyTimeline'

describe('AudioPlayer available PCM metadata', () => {
  it('exposes only submitted complete bins, without advancing the consumed clock', () => {
    const timeline = new PcmEnergyTimeline(1000)
    const pcm = new Float32Array(200).fill(0.1)
    timeline.append(pcm, 0, 125)
    const snapshot = timeline.snapshot(0, 0.1)
    expect(snapshot?.energy.length).toBe(2)
    expect(snapshot?.startSample).toBe(0)
    expect(snapshot?.finalSample).toBeNull()
    timeline.finish()
    expect(timeline.snapshot(100, 0.1)?.energy.length).toBe(1)
    expect(timeline.snapshot(100, 0.1)?.finalSample).toBe(125)
    expect(timeline.snapshot(125, 0.1)).toBeUndefined()
  })

  it('bounds retention and upcoming context and returns independent copies', () => {
    const timeline = new PcmEnergyTimeline(1000)
    const pcm = new Float32Array(10000).fill(0.1)
    timeline.append(pcm, 0, pcm.length)
    const snapshot = timeline.snapshot(7000, 0.1)
    expect(snapshot?.energy.length).toBeLessThanOrEqual(30)
    if (snapshot) snapshot.energy[0] = 0
    expect(timeline.snapshot(7000, 0.1)?.energy[0]).toBeGreaterThan(0.9)
    expect(timeline.snapshot(0, 0.1)).toBeUndefined()
  })
})
