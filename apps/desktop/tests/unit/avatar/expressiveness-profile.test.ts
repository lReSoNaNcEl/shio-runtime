import { describe, expect, it } from 'vitest'

import {
  armRangeKey,
  expressivenessProfile,
} from '../../../src/renderer/avatar/tuning/expressivenessProfile'
import { facialTuning } from '../../../src/renderer/avatar/tuning/facialTuning'
import { headMotionTuning } from '../../../src/renderer/avatar/tuning/motionTuning'

describe('expressiveness profile', () => {
  it('pins the conversational and rest limits', () => {
    const { conversational } = expressivenessProfile.standingArmRange
    expect(conversational).toEqual({ shoulder: 0.14, upper: 0.95, lower: 1.6 })
    expect(expressivenessProfile.restAfterSpeech).toEqual({
      maximum: { shoulder: 0.04, upper: 0.08, lower: 0.18 },
      retainedFraction: 0.15,
    })
    expect(expressivenessProfile.restAfterAct).toEqual({
      speaking: { maximum: { shoulder: 0.04, upper: 0.35, lower: 0.9 }, retainedFraction: 0.6 },
      quiet: { maximum: { shoulder: 0.04, upper: 0.08, lower: 0.18 }, retainedFraction: 0.15 },
    })
  })

  it('references the single tuning sources instead of copying them', () => {
    expect(expressivenessProfile.lipSyncClamps).toBe(facialTuning.lipSync.clamps)
    expect(expressivenessProfile.head.yawLimit).toBe(headMotionTuning.yawLimit)
  })

  it('selects arm range keys by bone segment', () => {
    expect(armRangeKey('leftLowerArm')).toBe('lower')
    expect(armRangeKey('rightUpperArm')).toBe('upper')
    expect(armRangeKey('leftShoulder')).toBe('shoulder')
  })
})
