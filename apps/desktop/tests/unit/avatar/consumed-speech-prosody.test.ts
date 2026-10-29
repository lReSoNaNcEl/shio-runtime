import { describe, expect, it } from 'vitest'

import type { PcmPlaybackClock } from '../../../src/renderer/audio/audioPlayer'
import { ConsumedSpeechProsody } from '../../../src/renderer/avatar/rendering/three/ConsumedSpeechProsody'

const clock = (
  offset: number,
  state: PcmPlaybackClock['state'] = 'playing',
  playbackId = 'a',
): PcmPlaybackClock => ({
  playbackId,
  turnId: 'turn',
  sourceSampleOffset: offset,
  sourceSampleRate: 44100,
  state,
})

describe('consumed speech context', () => {
  it('does not advance on render ticks, buffering, or regressing PCM', () => {
    const owner = new ConsumedSpeechProsody()
    owner.observe(clock(4410), 0.1)
    owner.observe(clock(4410), 0.8)
    owner.observe(clock(2205), 0.8)
    owner.observe(clock(8820, 'buffering'), 0.8)
    expect(owner.snapshot(clock(4410), 0)?.envelope).toEqual([0.1])
    expect(owner.snapshot(clock(8820, 'buffering'), 0)).toBeUndefined()
  })

  it('bounds history and drops expired or too-distant accents instead of predicting audio', () => {
    const owner = new ConsumedSpeechProsody()
    for (let sample = 1; sample <= 40; sample++) owner.observe(clock(sample * 4410), 0.1)
    owner.observe(clock(180810), 0.6)
    const fresh = owner.snapshot(clock(180810), 0)
    expect(fresh?.throughSample).toBe(180810)
    expect(fresh?.envelope.length).toBeLessThanOrEqual(12)
    expect(fresh?.accent).toBeGreaterThan(0)
    expect(owner.snapshot(clock(180810), 15)?.accent).toBe(0)
    expect(owner.snapshot(clock(198450), 0)?.accent).toBe(0)
  })

  it('distinguishes a sustained pause and resets the previous playback envelope', () => {
    const owner = new ConsumedSpeechProsody()
    for (let sample = 1; sample <= 6; sample++) owner.observe(clock(sample * 4410), 0)
    expect(owner.snapshot(clock(26460), 0)?.phase).toBe('pause')
    owner.observe(clock(4410, 'playing', 'b'), 0.2)
    expect(owner.snapshot(clock(4410, 'playing', 'b'), 0)?.envelope).toEqual([0.2])
    expect(owner.snapshot(clock(26460), 0)).toBeUndefined()
    owner.reset()
    expect(owner.snapshot(clock(4410, 'playing', 'b'), 0)).toBeUndefined()
  })
})
