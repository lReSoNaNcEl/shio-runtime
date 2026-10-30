import { describe, expect, it } from 'vitest'

import { resolveDeliveryStyle } from '../../src/shared/embodiment'
import { motionActivitySchema, motionChunkSchema } from '../../src/shared/motion'
import { createMotionChunk } from '../support/avatar/motionFixtures'

describe('experimental motion boundaries', () => {
  it('accepts only bounded acoustic metadata and rejects raw audio or unbounded values', () => {
    const activity = { energy: 0.25, playbackId: 'current-playback', speaking: true }
    expect(motionActivitySchema.safeParse(activity).success).toBe(true)
    for (const energy of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
      expect(motionActivitySchema.safeParse({ ...activity, energy }).success).toBe(false)
    }
    expect(motionActivitySchema.safeParse({ ...activity, pcm: [0.1] }).success).toBe(false)
    const prosody = {
      throughSample: 44100,
      sampleRate: 44100,
      envelope: [0.1, 0.2],
      phase: 'speech',
      accent: 0.2,
      leadMs: 100,
    }
    expect(motionActivitySchema.safeParse({ ...activity, prosody }).success).toBe(true)
    for (const invalid of [
      { ...prosody, envelope: Array(13).fill(0.1) },
      { ...prosody, accent: Number.NaN },
      { ...prosody, throughSample: -1 },
      { ...prosody, leadMs: 4001 },
      { ...prosody, text: 'untrusted' },
    ])
      expect(motionActivitySchema.safeParse({ ...activity, prosody: invalid }).success).toBe(false)
  })

  it('admits only the six bounded delivery style axes on the wire', () => {
    const activity = { energy: 0.25, playbackId: 'current-playback', speaking: true }
    const style = resolveDeliveryStyle('happy')
    expect(motionActivitySchema.safeParse({ ...activity, style }).success).toBe(true)
    for (const invalid of [
      { ...style, openness: 1.1 },
      { ...style, lean: -1.2 },
      { ...style, tempo: Number.NaN },
      { ...style, emotion: 'happy' },
      { openness: 0.5 },
    ])
      expect(motionActivitySchema.safeParse({ ...activity, style: invalid }).success).toBe(false)
  })

  it('rejects unpinned priors, invalid basis rotations and oversized hand horizons', () => {
    const chunk = createMotionChunk()
    const hands = {
      modelRevision: '233e9225c1da05c6a3dd98107b9f027f2366e3b972bbe67e0d164e5d28619fff',
      basis: { left: [0, 0, 0, 1], right: [0, 0, 0, 1] },
      rotations: structuredClone(chunk.rotations),
    }
    expect(motionChunkSchema.safeParse({ ...chunk, handDeltas: hands }).success).toBe(true)
    expect(
      motionChunkSchema.safeParse({ ...chunk, handDeltas: { ...hands, modelRevision: 'other' } })
        .success,
    ).toBe(false)
    expect(
      motionChunkSchema.safeParse({
        ...chunk,
        handDeltas: { ...hands, basis: { ...hands.basis, left: [0, 0, 0, 0] } },
      }).success,
    ).toBe(false)
    expect(
      motionChunkSchema.safeParse({
        ...chunk,
        handDeltas: { ...hands, rotations: [...hands.rotations, hands.rotations[0]] },
      }).success,
    ).toBe(false)
  })
})
