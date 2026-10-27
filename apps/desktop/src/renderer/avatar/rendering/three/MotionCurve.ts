/** Quintic Hermite segment with explicit endpoint velocity and acceleration.
 * Internal kinematic data only; no independent clock or pose application.
 */
export class MotionCurve {
  private readonly c: readonly number[]
  constructor(
    readonly start: number,
    readonly duration: number,
    from: number,
    readonly to: number,
    velocity = 0,
    acceleration = 0,
    private readonly endVelocity = 0,
    private readonly endAcceleration = 0,
  ) {
    const b = velocity * duration,
      c = (acceleration * duration * duration) / 2
    const distance = to - from - b - c,
      v = endVelocity * duration - b - 2 * c,
      a = endAcceleration * duration * duration - 2 * c
    this.c = [
      from,
      b,
      c,
      10 * distance - 4 * v + a / 2,
      -15 * distance + 7 * v - a,
      6 * distance - 3 * v + a / 2,
    ]
  }
  sample(at: number): { position: number; velocity: number; acceleration: number } {
    if (at >= this.start + this.duration)
      return { position: this.to, velocity: this.endVelocity, acceleration: this.endAcceleration }
    const u = Math.max(0, Math.min(1, (at - this.start) / this.duration))
    const [a, b, c, d, e, f] = this.c
    return {
      position: a + u * (b + u * (c + u * (d + u * (e + u * f)))),
      velocity: (b + u * (2 * c + u * (3 * d + u * (4 * e + u * 5 * f)))) / this.duration,
      acceleration:
        (2 * c + u * (6 * d + u * (12 * e + u * 20 * f))) / (this.duration * this.duration),
    }
  }
}
