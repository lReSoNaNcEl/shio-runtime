import * as THREE from 'three'

import type { MotionPhaseId } from '../../../../shared/motion'

export type MotionClass = 'presence' | 'gesture' | 'reaction' | 'full-body'
export const MOTIONBRICKS_CONVERSATION_MAX_JOINT_SPEED = 1.5
export interface MotionFilterContext {
  /** Remaining authored time for preparation or deterministic presence recovery. */
  reachSeconds?: number
  motionClass: MotionClass
  sourceProvider?: 'ardy' | 'motionbricks'
  phase: MotionPhaseId
  sourceSpeeds?: ReadonlyMap<THREE.Object3D, number>
  onIntegrated?: (bone: THREE.Object3D) => void
  onProjected?: (bone: THREE.Object3D) => void
  jointKinds?: ReadonlyMap<THREE.Object3D, 'torso' | 'shoulder' | 'arm' | 'wrist'>
}
interface State {
  target: THREE.Quaternion
  velocity: THREE.Vector3
  integrated?: THREE.Quaternion
}
const log = (rotation: THREE.Quaternion): THREE.Vector3 => {
  const q = rotation.clone().normalize()
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  const axis = new THREE.Vector3(q.x, q.y, q.z)
  const length = axis.length()
  return length < 1e-10
    ? axis.set(0, 0, 0)
    : axis.multiplyScalar((2 * Math.atan2(length, q.w)) / length)
}

/** A single acceleration-bounded tracker, after target projection and before sweep.
 * Target velocity is measured in consumed source time. No elapsed waiting time is
 * banked for catch-up, and no filter state is seeded from a neural T-pose jump.
 */
export class AdaptiveMotionFilter {
  private readonly states = new Map<THREE.Object3D, State>()

  reset(): void {
    this.states.clear()
  }

  hold(): void {
    for (const state of this.states.values()) state.velocity.set(0, 0, 0)
  }

  step(
    bone: THREE.Object3D,
    previous: THREE.Quaternion,
    target: THREE.Quaternion,
    seconds: number,
    context: MotionFilterContext,
  ): void {
    const dt = Math.max(0, Math.min(0.05, seconds))
    if (dt === 0) {
      bone.quaternion.copy(previous)
      return
    }
    const state = this.states.get(bone) ?? { target: target.clone(), velocity: new THREE.Vector3() }
    const error = log(target.clone().multiply(previous.clone().invert()))
    const sourceVelocity = log(target.clone().multiply(state.target.clone().invert())).divideScalar(
      dt,
    )
    const kind = context.jointKinds?.get(bone)
    const torso = kind === 'torso'
    const shoulder = kind === 'shoulder'
    const wrist = kind === 'wrist'
    const presence = context.motionClass === 'presence'
    const reaction = context.motionClass === 'reaction'
    const phaseScale = context.phase === 'recover' ? 0.7 : context.phase === 'prepare' ? 0.85 : 1
    // Long segments have a smaller tip-acceleration envelope. Normalized rig
    // geometry changes this bound without assuming one avatar's metre scale.
    const lever = Math.max(0.12, ...bone.children.map((child) => child.position.length()))
    const geometry = THREE.MathUtils.clamp(0.3 / lever, 0.65, 1.4)
    const acceleration =
      (presence ? 7 : reaction ? 65 : 45) *
      (torso ? 0.3 : shoulder ? 0.6 : 1) *
      geometry *
      phaseScale
    const ceiling = Math.min(
      (presence ? 1.6 : reaction ? 8 : 6) * (torso ? 0.35 : shoulder ? 0.6 : wrist ? 0.75 : 1),
      context.sourceProvider === 'motionbricks' && !presence
        ? MOTIONBRICKS_CONVERSATION_MAX_JOINT_SPEED
        : Infinity,
    )
    const sourceSpeed = context.sourceSpeeds?.get(bone) ?? sourceVelocity.length()
    sourceVelocity.clampLength(0, sourceSpeed)
    const reachingSpeed =
      ((!presence && context.phase === 'prepare') ||
        (presence && context.phase === 'recover' && context.sourceProvider === 'motionbricks')) &&
      Number.isFinite(context.reachSeconds)
        ? error.length() / Math.max(0.25, context.reachSeconds ?? 0.25)
        : 0
    const speed = Math.min(
      ceiling,
      Math.max(
        presence ? 0.15 : 0.6,
        reachingSpeed,
        sourceSpeed * 1.25 + Math.min(presence ? 0.25 : 0.8, error.length() * 3),
      ),
    )
    // Tiny projected presence deltas contain hinge/contact noise. Feeding their
    // derivative forward made quiet idle visibly vibrate. Position tracking
    // retains its slow neural motion; expressive acts retain source velocity.
    // Solve the existing position/velocity tracker as a critically damped
    // system. A velocity command followed instantaneously within the envelope
    // transmits 30 Hz source corners (and their derivative) into the body.
    // The analytic step is stable at different render rates, and velocity
    // feed-forward preserves a moving stroke without a second filter or clock.
    const feed = presence ? new THREE.Vector3() : sourceVelocity
    // Measured MotionBricks standing output contains rapid pose noise even
    // with held goals. Use the same tracker at a calm presence bandwidth;
    // expressive phases keep their existing timing and source feed-forward.
    const frequency = presence ? (context.sourceProvider === 'motionbricks' ? 8 : 28) : 48
    const relativeVelocity = state.velocity.clone().sub(feed)
    const initialError = error.clone().addScaledVector(feed, -dt)
    const decay = Math.exp(-frequency * dt)
    const remainder = initialError
      .clone()
      .multiplyScalar(1 + frequency * dt)
      .addScaledVector(relativeVelocity, -dt)
      .multiplyScalar(decay)
    const desired = relativeVelocity
      .clone()
      .multiplyScalar(1 - frequency * dt)
      .addScaledVector(initialError, frequency * frequency * dt)
      .multiplyScalar(decay)
      .add(feed)
    const limited =
      desired.length() > speed || desired.distanceTo(state.velocity) > acceleration * dt
    const change = desired
      .clampLength(0, speed)
      .sub(state.velocity)
      .clampLength(0, acceleration * dt)
    // A decreasing tracking envelope is a braking request, not permission to
    // instantaneously clip actual velocity at a phase/horizon boundary.
    state.velocity.add(change)
    const step = limited ? state.velocity.clone().multiplyScalar(dt) : error.clone().sub(remainder)
    const angle = step.length()
    bone.quaternion.copy(previous)
    if (angle > 1e-10)
      bone.quaternion
        .premultiply(new THREE.Quaternion().setFromAxisAngle(step.divideScalar(angle), angle))
        .normalize()
    state.target.copy(target)
    state.integrated = bone.quaternion.clone()
    this.states.set(bone, state)
  }

  /** A contact sweep may shorten integration. Never retain rejected momentum. */
  reconcile(bone: THREE.Object3D, previous: THREE.Quaternion, seconds: number): void {
    const state = this.states.get(bone)
    if (
      state &&
      seconds > 0 &&
      (!state.integrated || 1 - Math.abs(state.integrated.dot(bone.quaternion)) > 1e-12)
    )
      state.velocity
        .copy(log(bone.quaternion.clone().multiply(previous.clone().invert())))
        .divideScalar(Math.min(0.05, seconds))
  }
}
