import { MathUtils, Vector3 } from 'three'

/** Phase-local source displacement; no clock or independent animation. */
export class WorkspaceTrajectory {
  private readonly scale: number
  private readonly origin: Vector3
  private readonly start: Vector3

  constructor(
    origin: Vector3,
    start: Vector3,
    envelope?: {
      displacements: readonly Vector3[]
      axes: readonly Vector3[]
      extents: readonly number[]
    },
  ) {
    this.origin = origin.clone()
    this.start = start.clone()
    const minimum = [0, 0, 0],
      maximum = [0, 0, 0]
    if (envelope)
      for (const point of envelope.displacements)
        for (let axis = 0; axis < 3; axis++) {
          const value = point.dot(envelope.axes[axis]) / Math.max(0.0001, envelope.extents[axis])
          minimum[axis] = Math.min(minimum[axis], value)
          maximum[axis] = Math.max(maximum[axis], value)
        }
    this.scale = Math.min(
      1,
      ...minimum.map((min, axis) => 1.8 / Math.max(1e-10, maximum[axis] - min)),
    )
    if (envelope)
      for (let axis = 0; axis < 3; axis++)
        this.start.setComponent(
          axis,
          MathUtils.clamp(
            this.start.getComponent(axis),
            -0.9 - minimum[axis] * this.scale,
            0.9 - maximum[axis] * this.scale,
          ),
        )
  }

  sample(source: Vector3, axes: Vector3[], extents: number[]): Vector3 {
    const displacement = source.clone().sub(this.origin)
    return new Vector3(
      ...(axes.map((axis, index) =>
        MathUtils.clamp(
          this.start.getComponent(index) +
            (displacement.dot(axis) * this.scale) / Math.max(0.0001, extents[index]),
          -0.9,
          0.9,
        ),
      ) as [number, number, number]),
    )
  }
}
