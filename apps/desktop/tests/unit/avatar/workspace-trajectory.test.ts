import { Vector3 } from 'three'
import { expect, it } from 'vitest'

import { WorkspaceTrajectory } from '../../../src/renderer/avatar/rendering/three/WorkspaceTrajectory'

it('preserves compact source displacement even when absolute source position is outside the region', () => {
  const origin = new Vector3(10, -4, 7)
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  const trajectory = new WorkspaceTrajectory(origin, new Vector3())
  const first = trajectory.sample(origin, axes, [0.04, 0.04, 0.04])
  const next = trajectory.sample(
    origin.clone().add(new Vector3(0, 0.02, 0)),
    axes,
    [0.04, 0.04, 0.04],
  )
  expect(first.length()).toBe(0)
  expect(next.y * 0.04).toBeCloseTo(0.02)
  expect(
    trajectory.sample(origin.clone().addScalar(100), axes, [0.04, 0.04, 0.04]).toArray(),
  ).toEqual([0.9, 0.9, 0.9])
  expect(trajectory.sample(origin, axes, [0.04, 0.04, 0.04]).toArray()).toEqual(first.toArray())
})
