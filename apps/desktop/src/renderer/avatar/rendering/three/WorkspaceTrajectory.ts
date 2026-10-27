import { MathUtils, Vector3 } from 'three'

/** Phase-local source displacement; no clock or independent animation. */
export class WorkspaceTrajectory {
  constructor(
    private readonly origin: Vector3,
    private readonly start: Vector3,
  ) {}

  sample(source: Vector3, axes: Vector3[], extents: number[]): Vector3 {
    const displacement = source.clone().sub(this.origin)
    return new Vector3(
      ...(axes.map((axis, index) =>
        MathUtils.clamp(
          this.start.getComponent(index) +
            displacement.dot(axis) / Math.max(0.0001, extents[index]),
          -0.9,
          0.9,
        ),
      ) as [number, number, number]),
    )
  }
}
