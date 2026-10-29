import { describe, expect, it } from 'vitest'

import { standingArmRange } from '../../../src/renderer/avatar/rendering/three/StandingMotionStyle'
import { getMotionProfile } from '../../../src/shared/motion'

describe('standing arm artistic range', () => {
  const presence = getMotionProfile('presence_speaking')
  const gesture = getMotionProfile('explain_one_palm')

  it('keeps quiet presence arms near the calibrated rest', () => {
    if (!presence) throw new Error('missing presence_speaking')
    expect(standingArmRange(presence, 'hold', 'rightLowerArm')).toBe(0.25)
    expect(standingArmRange(presence, 'hold', 'rightUpperArm')).toBe(0.12)
    expect(standingArmRange(presence, 'hold', 'rightShoulder')).toBe(0.08)
  })

  it('admits the forearm-forward conversational base only during speech', () => {
    if (!presence) throw new Error('missing presence_speaking')
    const lower = standingArmRange(presence, 'hold', 'leftLowerArm', 1) ?? 0
    const upper = standingArmRange(presence, 'hold', 'leftUpperArm', 1) ?? 0
    // A raised conversational forearm needs roughly 70-90 degrees of elbow flexion.
    expect(lower).toBeGreaterThan(1.3)
    expect(upper).toBeGreaterThan(0.4)
    expect(standingArmRange(presence, 'hold', 'leftShoulder', 1)).toBeLessThan(0.2)
    // After speech the range fades monotonically back to the quiet standing range.
    const fading = standingArmRange(presence, 'hold', 'leftLowerArm', 0.5) ?? 0
    expect(fading).toBeGreaterThan(0.25)
    expect(fading).toBeLessThan(lower)
  })

  it('leaves expressive lead arms unbounded and support arms unchanged by speech', () => {
    if (!gesture) throw new Error('missing explain_one_palm')
    expect(standingArmRange(gesture, 'stroke', 'rightLowerArm', 1)).toBeNull()
    expect(standingArmRange(gesture, 'stroke', 'leftLowerArm', 1)).toBe(0.25)
    expect(standingArmRange(gesture, 'stroke', 'hips')).toBeNull()
  })
})
