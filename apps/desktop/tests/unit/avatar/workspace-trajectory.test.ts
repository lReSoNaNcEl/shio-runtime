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

it('fits a neural stroke at a boundary without clipping its amplitude or moving a valid entry', () => {
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  const start = new Vector3(0, 0.9, 0)
  const displacement = new Vector3(0, 0.02, 0)
  const trajectory = new WorkspaceTrajectory(new Vector3(), start, {
    displacements: [new Vector3(), displacement],
    axes,
    extents: [0.04, 0.04, 0.04],
  })
  const entry = trajectory.sample(new Vector3(), axes, [0.04, 0.04, 0.04])
  const stroke = trajectory.sample(displacement, axes, [0.04, 0.04, 0.04])
  expect((stroke.y - entry.y) * 0.04).toBeCloseTo(0.02)
  expect(stroke.y).toBeCloseTo(0.9)
  expect(start.y).toBe(0.9)
  const admitted = new WorkspaceTrajectory(new Vector3(), new Vector3(0, 0.2, 0), {
    displacements: [new Vector3(), displacement],
    axes,
    extents: [0.04, 0.04, 0.04],
  })
  expect(admitted.sample(new Vector3(), axes, [0.04, 0.04, 0.04]).y).toBe(0.2)
})

it('uses a uniform non-amplifying fit when a source arc exceeds the anatomical region', () => {
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  const displacement = new Vector3(0.2, 0.1, 0)
  const trajectory = new WorkspaceTrajectory(new Vector3(), new Vector3(), {
    displacements: [new Vector3(), displacement],
    axes,
    extents: [0.04, 0.04, 0.04],
  })
  const before = trajectory.sample(new Vector3(), axes, [0.04, 0.04, 0.04])
  const after = trajectory.sample(displacement, axes, [0.04, 0.04, 0.04])
  const fitted = after.sub(before)
  expect(fitted.x / fitted.y).toBeCloseTo(2)
  expect(fitted.x * 0.04).toBeCloseTo(0.072)
})
