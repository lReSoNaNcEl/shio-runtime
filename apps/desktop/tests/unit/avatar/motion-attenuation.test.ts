import { describe, expect, it } from 'vitest'

import {
  MotionAttenuationAggregator,
  motionAttenuationChannel,
  NOOP_MOTION_ATTENUATION_PROBE,
} from '../../../src/renderer/avatar/MotionAttenuation'

function aggregator(capacity?: number) {
  let now = 0
  const probe = new MotionAttenuationAggregator({ now: () => now, windowMs: 1000, capacity })
  return { probe, advance: (ms: number) => (now += ms) }
}

describe('motion attenuation attribution', () => {
  it('reports a ratio of one for unlimited motion and below one for a limited stage', () => {
    const { probe } = aggregator()
    probe.report('adaptive-filter', 'rightHand', 0.4, 0.4)
    probe.report('standing-arm-range', 'rightHand', 1, 0.25)
    const entries = probe.snapshot().channels.rightHand
    expect(entries[0]).toEqual({
      stage: 'standing-arm-range',
      ratio: 0.25,
      limitedShare: 1,
      samples: 1,
    })
    expect(entries[1]).toMatchObject({ stage: 'adaptive-filter', ratio: 1, limitedShare: 0 })
  })

  it('ranks the three strongest limiters of a channel', () => {
    const { probe } = aggregator()
    probe.report('lipsync-clamp', 'mouth', 1, 0.9)
    probe.report('expression-mixer', 'mouth', 1, 0.3)
    probe.report('head-authority', 'mouth', 1, 0.6)
    probe.report('adaptive-filter', 'mouth', 1, 0.95)
    expect(probe.snapshot().channels.mouth.map((entry) => entry.stage)).toEqual([
      'expression-mixer',
      'head-authority',
      'lipsync-clamp',
    ])
  })

  it('forgets reports older than its window', () => {
    const { probe, advance } = aggregator()
    probe.report('recover-rest', 'leftHand', 1, 0.15)
    advance(1001)
    probe.report('recover-rest', 'leftHand', 1, 1)
    const snapshot = probe.snapshot()
    expect(snapshot.samples).toBe(1)
    expect(snapshot.channels.leftHand[0].ratio).toBe(1)
  })

  it('bounds memory with a ring and counts overwritten in-window reports', () => {
    const { probe } = aggregator(4)
    for (let index = 0; index < 6; index++) probe.report('body-safety.hinge', 'torso', 1, 0.5)
    const snapshot = probe.snapshot()
    expect(snapshot.samples).toBe(4)
    expect(snapshot.dropped).toBe(2)
  })

  it('ignores invalid and negligible requests and never reports amplification', () => {
    const { probe } = aggregator()
    probe.report('adaptive-filter', 'head', Number.NaN, 1)
    probe.report('adaptive-filter', 'head', 1, Number.POSITIVE_INFINITY)
    probe.report('adaptive-filter', 'head', 0, 0)
    expect(probe.snapshot().samples).toBe(0)
    probe.report('adaptive-filter', 'head', 0.5, 2)
    expect(probe.snapshot().channels.head[0].ratio).toBe(1)
  })

  it('exposes only dimensionless ratios and counts', () => {
    const { probe } = aggregator()
    probe.report('body-safety.contact', 'leftHand', 1, 0)
    const keys = Object.keys(probe.snapshot().channels.leftHand[0]).sort()
    expect(keys).toEqual(['limitedShare', 'ratio', 'samples', 'stage'])
  })

  it('clears state idempotently', () => {
    const { probe } = aggregator()
    probe.report('lipsync-clamp', 'mouth', 1, 0.5)
    probe.reset()
    probe.reset()
    expect(probe.snapshot().samples).toBe(0)
  })

  it('keeps the production probe inactive and stateless', () => {
    expect(NOOP_MOTION_ATTENUATION_PROBE.active).toBe(false)
    expect(Object.isFrozen(NOOP_MOTION_ATTENUATION_PROBE)).toBe(true)
    expect(NOOP_MOTION_ATTENUATION_PROBE.report('adaptive-filter', 'head', 1, 0)).toBeUndefined()
  })

  it('maps arm, head and torso bones to channels and ignores fingers and legs', () => {
    expect(motionAttenuationChannel('leftLowerArm')).toBe('leftHand')
    expect(motionAttenuationChannel('rightShoulder')).toBe('rightHand')
    expect(motionAttenuationChannel('neck')).toBe('head')
    expect(motionAttenuationChannel('upperChest')).toBe('torso')
    expect(motionAttenuationChannel('leftIndexProximal')).toBeNull()
    expect(motionAttenuationChannel('rightUpperLeg')).toBeNull()
  })
})
