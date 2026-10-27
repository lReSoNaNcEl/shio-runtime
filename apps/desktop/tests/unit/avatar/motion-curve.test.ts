import { describe, expect, it } from 'vitest'

import { MotionCurve } from '../../../src/renderer/avatar/rendering/three/MotionCurve'

describe('kinematic segment continuity', () => {
  it('preserves nonzero velocity and acceleration when adjoining planned horizons', () => {
    const first = new MotionCurve(0, 1.3, 0, 0.7, 0, 0, 0.24, -0.12)
    const end = first.sample(1.3)
    const second = new MotionCurve(1.3, 0.9, end.position, 1.1, end.velocity, end.acceleration)
    const before = first.sample(1.3 - 1e-6),
      after = second.sample(1.3 + 1e-6)
    expect(Math.abs(before.position - after.position)).toBeLessThan(1e-6)
    expect(Math.abs(before.velocity - after.velocity)).toBeLessThan(1e-6)
    expect(Math.abs(before.acceleration - after.acceleration)).toBeLessThan(1e-4)
    expect(second.sample(2.2)).toEqual({ position: 1.1, velocity: 0, acceleration: 0 })
  })
})
