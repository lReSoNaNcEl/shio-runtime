import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const { assessGesture } = createRequire(import.meta.url)(
  '../../../qualifications/speech-motion/conversation-evidence.cjs',
)
const moving = () => ({
  strokeSamples: 12,
  strokeDurationMs: 200,
  joints: { rightUpperArm: { excursionRad: 0.4 } },
  hands: { rightHand: { excursionM: 0.12, strokeExcursionM: 0.04 } },
})

describe('visible gesture evidence', () => {
  it('rejects preparation-only and motionless executions despite profile/source activity', () => {
    expect(
      assessGesture({ ...moving(), strokeSamples: 0, strokeDurationMs: 0 }, 'greeting').passed,
    ).toBe(false)
    expect(
      assessGesture(
        { ...moving(), hands: { rightHand: { excursionM: 0, strokeExcursionM: 0 } } },
        'explain',
      ).passed,
    ).toBe(false)
  })
  it('requires actual stroke motion, not only a raised preparation pose', () => {
    expect(
      assessGesture(
        { ...moving(), hands: { rightHand: { excursionM: 0.12, strokeExcursionM: 0 } } },
        'greeting',
      ).passed,
    ).toBe(false)
    expect(assessGesture(moving(), 'greeting')).toMatchObject({
      passed: true,
      visualAcceptance: 'pending',
    })
  })
})
