import { Quaternion, Vector3 } from 'three'

type Rotation = readonly [number, number, number, number]

const relativeLog = (origin: Quaternion, value: Quaternion): Vector3 => {
  const q = origin.clone().invert().multiply(value).normalize()
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  const axis = new Vector3(q.x, q.y, q.z)
  const length = axis.length()
  return length < 1e-10 ? axis.set(0, 0, 0) : axis.multiplyScalar(Math.atan2(length, q.w) / length)
}

const control = (q: Quaternion, before: Quaternion, after: Quaternion): Quaternion => {
  const tangent = relativeLog(q, before).add(relativeLog(q, after)).multiplyScalar(-0.25)
  const length = tangent.length()
  return length < 1e-10
    ? q.clone()
    : q
        .clone()
        .multiply(new Quaternion().setFromAxisAngle(tangent.divideScalar(length), 2 * length))
}

/** C1 reconstruction of the existing 30 Hz source, using its buffered neighbours.
 * Interpolates every original knot at its original time; no cursor, history
 * integration, smoothing delay or authored motion. Safety still projects it.
 */
export function sampleSourceRotation(
  output: Quaternion,
  before: Rotation | undefined,
  start: Rotation,
  end: Rotation,
  after: Rotation | undefined,
  fraction: number,
): Quaternion {
  const q0 = new Quaternion().fromArray(start).normalize()
  const q1 = new Quaternion().fromArray(end).normalize()
  if (fraction <= 0) return output.copy(q0)
  if (fraction >= 1) return output.copy(q1)
  const c0 = before ? control(q0, new Quaternion().fromArray(before).normalize(), q1) : q0
  const c1 = after ? control(q1, q0, new Quaternion().fromArray(after).normalize()) : q1
  return output
    .copy(q0)
    .slerp(q1, fraction)
    .slerp(c0.slerp(c1, fraction), 2 * fraction * (1 - fraction))
    .normalize()
}
