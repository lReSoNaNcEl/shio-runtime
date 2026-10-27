import * as THREE from 'three'

/** Analytic two-bone placement in normalized VRM space; no facial authority. */
export function plantLeg(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  foot: THREE.Object3D,
  target: THREE.Vector3,
  orientation: THREE.Quaternion,
  pole = new THREE.Vector3(0, 0, 1),
): void {
  const hip = upper.getWorldPosition(new THREE.Vector3())
  const knee = lower.getWorldPosition(new THREE.Vector3())
  const ankle = foot.getWorldPosition(new THREE.Vector3())
  const a = hip.distanceTo(knee),
    b = knee.distanceTo(ankle)
  if (a < 0.001 || b < 0.001) return
  const direction = target.clone().sub(hip)
  const distance = Math.max(Math.abs(a - b) + 0.0001, Math.min(a + b - 0.0001, direction.length()))
  if (direction.lengthSq() < 1e-10) direction.set(0, -1, 0)
  direction.normalize()
  // The generated knee can cross the straight-leg singularity by tiny amounts.
  // Its current position must never choose the anatomical bend hemisphere.
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction))
  if (bend.lengthSq() < 1e-8) {
    bend.set(1, 0, 0).addScaledVector(direction, -direction.x)
    if (bend.lengthSq() < 1e-8) bend.set(0, 1, 0).addScaledVector(direction, -direction.y)
  }
  bend.normalize()
  const reachableAnkle = hip.clone().addScaledVector(direction, distance)
  const x = (a * a - b * b + distance * distance) / (2 * distance)
  const desiredKnee = hip
    .clone()
    .addScaledVector(direction, x)
    .addScaledVector(bend, Math.sqrt(Math.max(0, a * a - x * x)))
  const referencePole = pole.clone().applyQuaternion(orientation.clone().invert())
  const frame = (axis: THREE.Vector3, forward: THREE.Vector3): THREE.Quaternion => {
    axis.normalize()
    const tangent = forward.clone().addScaledVector(axis, -forward.dot(axis))
    if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0).addScaledVector(axis, -axis.x)
    tangent.normalize()
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(axis, tangent, axis.clone().cross(tangent).normalize()),
    )
  }
  const orient = (bone: THREE.Object3D, restAxis: THREE.Vector3, to: THREE.Vector3): void => {
    // Resolve the full frame from the anatomical support plane. A minimal
    // swing from a generated rotation would preserve arbitrary axial twist.
    const world = frame(to, pole).multiply(frame(restAxis, referencePole).invert())
    const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
    bone.quaternion.copy(parent.invert().multiply(world)).normalize()
    bone.updateMatrixWorld(true)
  }
  orient(upper, lower.position.clone(), desiredKnee.clone().sub(hip))
  const movedKnee = lower.getWorldPosition(new THREE.Vector3())
  orient(lower, foot.position.clone(), reachableAnkle.sub(movedKnee))
  const parent = foot.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
  foot.quaternion.copy(parent.invert().multiply(orientation)).normalize()
  foot.updateMatrixWorld(true)
}
