import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import type { BodyClearanceCalibration } from './GeneratedBodyCalibration'

/** Stateless limb and torso geometry of the generated body safety passes.
 * Moved verbatim from GeneratedBodySafety; the owner keeps all state. */
export type Limb = {
  upper: THREE.Object3D
  lower: THREE.Object3D
  end: THREE.Object3D
  rest: THREE.Quaternion
  endRest: THREE.Quaternion
  axis: THREE.Vector3
  flexAxis: THREE.Vector3
  hinge: THREE.Vector3
  sign: number
  side: number
  maximum: number
  twistLimit: number
  radius: number
  upperRadius: number
  fingerAxis: THREE.Vector3
  palmAxis: THREE.Vector3
}
export type Torso = {
  center: THREE.Vector3
  x: THREE.Vector3
  y: THREE.Vector3
  front: THREE.Vector3
  radii: THREE.Vector3
  width: number
}
export type ArmPose = {
  upper: THREE.Quaternion
  lower: THREE.Quaternion
  end: THREE.Quaternion
  wristWorld?: THREE.Vector3
}
export const clamp = THREE.MathUtils.clamp
export const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle))

export function armPose(arm: Limb): ArmPose {
  return {
    upper: arm.upper.quaternion.clone(),
    lower: arm.lower.quaternion.clone(),
    end: arm.end.quaternion.clone(),
  }
}

export function clearRecoveryPath(arm: Limb, from: ArmPose, to: ArmPose, torso: Torso): boolean {
  const set = (pose: ArmPose, fraction = 1): void => {
    arm.upper.quaternion.copy(from.upper).slerp(pose.upper, fraction)
    arm.lower.quaternion.copy(from.lower).slerp(pose.lower, fraction)
    arm.end.quaternion.copy(from.end).slerp(pose.end, fraction)
    arm.upper.updateMatrixWorld(true)
  }
  set(from)
  const initial = torsoContact(arm, torso, 0.006)?.metric ?? 1
  let clear = true
  for (let sample = 1; sample <= 4; sample++) {
    set(to, sample / 4)
    const contact = torsoContact(arm, torso, 0.006)
    if (contact && (initial === 1 || contact.metric < initial - 1e-9)) {
      clear = false
      break
    }
  }
  set(to)
  return clear
}

export function projectWrist(arm: Limb, rotation: THREE.Quaternion): void {
  const delta = rotation.clone().multiply(arm.endRest.clone().invert()).normalize()
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
  const projection = new THREE.Vector3(delta.x, delta.y, delta.z).dot(arm.axis)
  const twist = new THREE.Quaternion(
    arm.axis.x * projection,
    arm.axis.y * projection,
    arm.axis.z * projection,
    delta.w,
  )
  if (twist.lengthSq() < 1e-10) twist.identity()
  else twist.normalize()
  const swing = delta.clone().multiply(twist.clone().invert())
  const angle = swing.angleTo(new THREE.Quaternion())
  if (angle > 0.55) swing.copy(new THREE.Quaternion().slerp(swing, 0.55 / angle))
  const twistAngle = clamp(wrap(2 * Math.atan2(projection, delta.w)), -0.85, 0.85)
  rotation
    .copy(swing)
    .multiply(new THREE.Quaternion().setFromAxisAngle(arm.axis, twistAngle))
    .multiply(arm.endRest)
    .normalize()
}

export function measureTorso(
  vrm: VRM | null,
  arms: readonly Limb[],
  clearance: BodyClearanceCalibration | null,
): Torso | null {
  if (!vrm) return null
  const hips = vrm.humanoid.getNormalizedBoneNode('hips')
  const left = arms.find((arm) => arm.side === 1)?.upper
  const right = arms.find((arm) => arm.side === -1)?.upper
  const neck = vrm.humanoid.getNormalizedBoneNode('neck')
  if (!hips || !left || !right) return null
  const bottom = hips.getWorldPosition(new THREE.Vector3())
  const top =
    neck?.getWorldPosition(new THREE.Vector3()) ??
    left
      .getWorldPosition(new THREE.Vector3())
      .add(right.getWorldPosition(new THREE.Vector3()))
      .multiplyScalar(0.5)
  const y = top.clone().sub(bottom)
  const height = y.length()
  const x = left
    .getWorldPosition(new THREE.Vector3())
    .sub(right.getWorldPosition(new THREE.Vector3()))
  const width = x.length()
  if (height < 0.01 || width < 0.01) return null
  y.normalize()
  x.addScaledVector(y, -x.dot(y)).normalize()
  const front = x.clone().cross(y).normalize()
  const scale =
    Math.max(0.001, Math.abs(vrm.scene.getWorldScale(new THREE.Vector3()).y)) /
    (clearance?.scale ?? 1)
  return {
    center: bottom
      .addScaledVector(y, height * 0.5)
      .addScaledVector(front, (clearance?.forwardOffset ?? 0) * scale),
    x,
    y,
    front,
    width,
    radii: new THREE.Vector3(
      (clearance?.halfWidth ?? width * 0.45) * scale,
      height * 0.62,
      (clearance?.halfDepth ?? width * 0.3) * scale,
    ),
  }
}

export function torsoContact(
  arm: Limb,
  torso: Torso,
  padding = 0,
): { point: THREE.Vector3; normal: THREE.Vector3; metric: number } | null {
  const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
  const elbow = arm.lower.getWorldPosition(new THREE.Vector3())
  const wrist = arm.end.getWorldPosition(new THREE.Vector3())
  const scaled = (point: THREE.Vector3, radii: THREE.Vector3): THREE.Vector3 => {
    const delta = point.clone().sub(torso.center)
    return new THREE.Vector3(
      delta.dot(torso.x) / radii.x,
      delta.dot(torso.y) / radii.y,
      delta.dot(torso.front) / radii.z,
    )
  }
  let worst: { point: THREE.Vector3; normal: THREE.Vector3; metric: number } | null = null
  const segments: Array<[THREE.Vector3, THREE.Vector3, number]> = [[elbow, wrist, arm.radius]]
  // The humerus attaches inside the shoulder/costume envelope. Inflating
  // that whole segment by a wide sleeve makes a relaxed arm impossible.
  // Admit attachment on its own side; still test an upper arm that crosses
  // medially into the chest, plus the complete elbow-to-wrist segment.
  const lateral = (point: THREE.Vector3): number =>
    point.clone().sub(torso.center).dot(torso.x) * arm.side
  if (lateral(elbow) < lateral(shoulder) * 0.8)
    segments.push([shoulder.clone().lerp(elbow, 0.7), elbow, arm.upperRadius])
  for (const [a, b, radius] of segments) {
    const radii = torso.radii.clone().addScalar(radius + padding)
    const from = scaled(a, radii),
      direction = scaled(b, radii).sub(from)
    const t =
      direction.lengthSq() > 1e-10 ? clamp(-from.dot(direction) / direction.lengthSq(), 0, 1) : 0
    const point = from.addScaledVector(direction, t)
    const metric = point.lengthSq()
    if (metric >= 1 || (worst && metric >= worst.metric)) continue
    const normal = torso.x
      .clone()
      .multiplyScalar(point.x / radii.x)
      .addScaledVector(torso.y, point.y / radii.y)
      .addScaledVector(torso.front, point.z / radii.z)
    worst = { point: a.clone().lerp(b, t), normal, metric }
  }
  return worst
}

export function penetrates(arm: Limb, torso: Torso, padding = 0): boolean {
  return torsoContact(arm, torso, padding) !== null
}

export function projectArm(arm: Limb, torso: Torso, maximum = 2, padding = 0): void {
  const contact = torsoContact(arm, torso, padding)
  if (!contact) return
  const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
  const lever = contact.point.clone().sub(shoulder)
  // Keep one correction plane throughout this projection. Recomputing the
  // gradient after every step can switch between opposite sides of the torso.
  const direction = contact.normal
    .clone()
    .addScaledVector(torso.front, Math.max(contact.normal.length(), 1 / torso.width))
  const axis = lever.clone().cross(direction)
  if (axis.lengthSq() < 1e-12) axis.copy(lever).cross(torso.front)
  if (axis.lengthSq() < 1e-12) return
  axis.normalize()
  const initial = arm.upper.getWorldQuaternion(new THREE.Quaternion())
  const parent =
    arm.upper.parent?.getWorldQuaternion(new THREE.Quaternion()).invert() ?? new THREE.Quaternion()
  const orientation = arm.end.getWorldQuaternion(new THREE.Quaternion())
  const set = (angle: number): void => {
    const world = initial.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle))
    arm.upper.quaternion.copy(parent).multiply(world).normalize()
    arm.upper.updateMatrixWorld(true)
  }
  let lower = 0
  for (let step = 1; step <= 40; step += 1) {
    let upper = (step * maximum) / 40
    set(upper)
    if (penetrates(arm, torso, padding)) {
      lower = upper
      continue
    }
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const middle = (lower + upper) / 2
      set(middle)
      if (penetrates(arm, torso, padding)) lower = middle
      else upper = middle
    }
    set(upper)
    const handParent =
      arm.end.parent?.getWorldQuaternion(new THREE.Quaternion()).invert() ?? new THREE.Quaternion()
    arm.end.quaternion.copy(handParent.multiply(orientation)).normalize()
    arm.end.updateMatrixWorld(true)
    return
  }
  set(0)
}

export function slideArm(arm: Limb, torso: Torso, budget: number): void {
  for (let iteration = 0; iteration < 8 && budget > 1e-6; iteration++) {
    const contact = torsoContact(arm, torso, 0.003)
    if (!contact) return
    const lever = contact.point.clone().sub(arm.upper.getWorldPosition(new THREE.Vector3()))
    const axis = lever.cross(contact.normal)
    const gradient = 2 * axis.length()
    if (gradient < 1e-6) return
    const angle = Math.min(budget, Math.max(0.00001, (1.001 - contact.metric) / gradient))
    axis.normalize()
    const world = arm.upper
      .getWorldQuaternion(new THREE.Quaternion())
      .premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle))
    const parent =
      arm.upper.parent?.getWorldQuaternion(new THREE.Quaternion()).invert() ??
      new THREE.Quaternion()
    arm.upper.quaternion.copy(parent).multiply(world).normalize()
    arm.upper.updateMatrixWorld(true)
    budget -= angle
  }
}
