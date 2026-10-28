import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { sampleSourceRotation } from '../../../src/renderer/avatar/rendering/three/sampleSourceRotation'

const rotation = (angle: number) =>
  new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle).toArray()

describe('buffered neural source reconstruction', () => {
  it('preserves every source pose and constant angular velocity without delay', () => {
    const knots = [0, 0.1, 0.2, 0.3].map(rotation)
    for (let index = 0; index <= 120; index++) {
      const t = index / 120
      const sampled = sampleSourceRotation(
        new Quaternion(),
        knots[0],
        knots[1],
        knots[2],
        knots[3],
        t,
      )
      expect(sampled.angleTo(new Quaternion().fromArray(rotation(0.1 + 0.1 * t)))).toBeLessThan(
        1e-7,
      )
    }
  })

  it('has the same angular velocity on both sides of an original frame', () => {
    const knots = [0, 0.01, 0.04, 0.08, 0.09].map(rotation)
    const epsilon = 1e-4
    const left = sampleSourceRotation(
      new Quaternion(),
      knots[0],
      knots[1],
      knots[2],
      knots[3],
      1 - epsilon,
    )
    const right = sampleSourceRotation(
      new Quaternion(),
      knots[1],
      knots[2],
      knots[3],
      knots[4],
      epsilon,
    )
    const middle = new Quaternion().fromArray(knots[2])
    expect(Math.abs(left.angleTo(middle) - right.angleTo(middle)) / epsilon).toBeLessThan(1e-4)
  })

  it('contains missing horizons and quaternion sign changes without inventing a turn', () => {
    const q = rotation(0.3),
      negative = q.map((value) => -value) as typeof q
    for (let index = 0; index < 100; index++) {
      const sampled = sampleSourceRotation(
        new Quaternion(),
        undefined,
        q,
        negative,
        undefined,
        index / 100,
      )
      expect(sampled.angleTo(new Quaternion().fromArray(q))).toBeLessThan(1e-7)
    }
  })
})
