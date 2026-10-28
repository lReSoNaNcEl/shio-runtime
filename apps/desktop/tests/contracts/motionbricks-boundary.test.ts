import { describe, expect, it } from 'vitest'

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
