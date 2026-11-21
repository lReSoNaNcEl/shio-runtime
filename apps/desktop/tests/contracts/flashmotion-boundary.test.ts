import { describe, expect, it } from 'vitest'

import { resolveDeliveryStyle } from '../../src/shared/embodiment'
import {
  FLASH_MOTION_FORMAT,
  motionActivitySchema,
  motionChunkSchema,
} from '../../src/shared/motion'
import { createMotionChunk, createMotionPlan } from '../support/avatar/motionFixtures'

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

  it('accepts native fingers only on a valid sample-aligned S2G horizon', () => {
    const plan = createMotionPlan({ clockDomain: 'speech', playbackId: 'playback' })
    const chunk = createMotionChunk({ plan, sourceProvider: 'flashmotion' })
    const flashMotion = {
      mode: 's2g',
      weightsRevision: FLASH_MOTION_FORMAT.weightsRevision,
      speech: { playbackId: 'playback', startSample: 1470, frames: 60 },
      fingers: structuredClone(chunk.rotations),
    }
    expect(motionChunkSchema.safeParse({ ...chunk, flashMotion }).success).toBe(true)
    for (const invalid of [
      { ...flashMotion, mode: 't2m' },
      { ...flashMotion, weightsRevision: 'other' },
      { ...flashMotion, speech: { ...flashMotion.speech, playbackId: 'stale' } },
      { ...flashMotion, speech: { ...flashMotion.speech, frames: 59 } },
      { ...flashMotion, fingers: flashMotion.fingers.slice(1) },
    ])
      expect(motionChunkSchema.safeParse({ ...chunk, flashMotion: invalid }).success).toBe(false)
  })
})
