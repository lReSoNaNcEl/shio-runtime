import * as THREE from 'three'

import { MotionCurve } from './MotionCurve'
import type { ProceduralTurnPlanner, TurnPlanningState } from './ProceduralTurnPlanner'
import { supportHull, supportMargin, supportsOverlap } from './TurnSupportGeometry'

const up = new THREE.Vector3(0, 1, 0)
const pitchAxis = new THREE.Vector3(1, 0, 0)
const ease = (u: number) => {
  const t = THREE.MathUtils.clamp(u, 0, 1)
  return t ** 3 * (10 + t * (-15 + 6 * t))
}

/** One rig-calibrated revolution around an acquired forefoot contact. */
export class PivotTurnPlan {
  readonly end: number
  readonly landing: number
  readonly takeoff: number
  readonly localPivot: THREE.Vector3
  readonly anchor: THREE.Vector3
  private readonly shiftIn: readonly [MotionCurve, MotionCurve]
  private readonly shiftOut: readonly [MotionCurve, MotionCurve]
  private readonly supportPoint: THREE.Vector2
  private readonly flatSupport: THREE.Vector2[]
  private readonly pivotPitch: number

  constructor(
    readonly stance: number,
    private readonly state: TurnPlanningState,
    private readonly planner: ProceduralTurnPlanner,
    private readonly direction: number,
    front: number,
    transfer: number,
    private readonly spin: number,
    private readonly crouch: number,
  ) {
    this.takeoff = transfer
    this.landing = transfer + spin
    this.end = this.landing + transfer
    const shape = new THREE.Box3().setFromPoints([...planner.legs[stance].sole])
    const mid = shape.getCenter(new THREE.Vector3())
    const foot = state.contacts[stance]
    const bodyOffset = state.root
      .clone()
      .sub(foot.position)
      .applyQuaternion(foot.orientation.clone().invert())
    this.localPivot = mid.clone()
    this.localPivot.x = THREE.MathUtils.lerp(
      mid.x,
      THREE.MathUtils.clamp(bodyOffset.x, shape.min.x, shape.max.x),
      0.32,
    )
    this.localPivot.z = mid.z + (front > 0 ? shape.max.z - mid.z : shape.min.z - mid.z) * 0.62
    this.pivotPitch = front * 0.25
    this.anchor = this.localPivot.clone().applyQuaternion(foot.orientation).add(foot.position)
    const startCom = state.root.clone().add(planner.comOffset)
    this.supportPoint = new THREE.Vector2(this.anchor.x, this.anchor.z)
    this.shiftIn = [
      new MotionCurve(0, transfer, startCom.x, this.anchor.x),
      new MotionCurve(0, transfer, startCom.z, this.anchor.z),
    ]
    this.shiftOut = [
      new MotionCurve(this.landing, transfer, this.anchor.x, startCom.x),
      new MotionCurve(this.landing, transfer, this.anchor.z, startCom.z),
    ]
    this.flatSupport = supportHull(
      state.contacts.flatMap((foot, index) => planner.footprint(index, foot)),
    )
  }

  private sampleHeading(at: number) {
    const duration = this.spin
    const t = THREE.MathUtils.clamp(at - this.takeoff, 0, duration)
    const ramp = Math.min(0.5, duration * 0.27)
    const total = this.direction * 2 * Math.PI
    const speed = total / (duration - ramp)
    // The speed ramps join the cruise with zero acceleration and jerk.
    const edge = Math.min(t, duration - t)
    if (edge >= ramp) return { position: speed * (t - ramp / 2), velocity: speed, acceleration: 0 }
    const u = edge / ramp
    const distance = speed * ramp * (2.5 * u ** 4 - 3 * u ** 5 + u ** 6)
    const braking = t > duration / 2
    return {
      position: braking ? total - distance : distance,
      velocity: speed * ease(u),
      acceleration: (braking ? -1 : 1) * (speed / ramp) * 30 * (u * (1 - u)) ** 2,
    }
  }

  sample(at: number) {
    const steering = this.sampleHeading(at)
    const turn = new THREE.Quaternion().setFromAxisAngle(up, steering.position)
    const turning = at > this.takeoff && at < this.landing
    const lifting = turning
      ? ease((at - this.takeoff) / 0.22) * ease((this.landing - at) / 0.25)
      : 0
    const weight = ease(at / this.takeoff) * ease((this.end - at) / (this.end - this.landing))
    const [curveX, curveZ] = at <= this.landing ? this.shiftIn : this.shiftOut
    const x = curveX.sample(at)
    const z = curveZ.sample(at)
    const root = new THREE.Vector3(x.position, this.state.root.y, z.position).sub(
      this.planner.comOffset.clone().applyQuaternion(turn),
    )
    root.y = this.state.root.y - weight * this.crouch
    const contacts = this.state.contacts.map((foot, index) => {
      const orientation = turn.clone().multiply(foot.orientation)
      if (index === this.stance) {
        orientation.multiply(
          new THREE.Quaternion().setFromAxisAngle(pitchAxis, lifting * this.pivotPitch),
        )
        return {
          orientation,
          position: this.anchor.clone().sub(this.localPivot.clone().applyQuaternion(orientation)),
        }
      }
      const position = foot.position.clone().sub(this.anchor).applyQuaternion(turn).add(this.anchor)
      position.y += this.planner.legLength * 0.075 * lifting
      return { position, orientation }
    })
    const height = Math.max(0.1, root.y + this.planner.comOffset.y - this.planner.floor)
    const zmp = new THREE.Vector2(
      x.position - (height / 9.81) * x.acceleration,
      z.position - (height / 9.81) * z.acceleration,
    )
    return {
      heading: steering.position,
      angularVelocity: steering.velocity,
      angularAcceleration: steering.acceleration,
      root,
      contacts,
      supporting: turning ? this.stance : null,
      balanceMargin: turning
        ? -zmp.distanceTo(this.supportPoint)
        : supportMargin(zmp, this.flatSupport),
      comVelocity: new THREE.Vector2(x.velocity, z.velocity),
      comAcceleration: new THREE.Vector2(x.acceleration, z.acceleration),
    }
  }

  feasible(): boolean {
    for (let step = 0; step <= 120; step++) {
      const pose = this.sample((step / 120) * this.end)
      if (pose.balanceMargin < -0.0005) return false
      const { planner } = this
      if (
        Math.hypot(pose.root.x - planner.centre.x, pose.root.z - planner.centre.z) >
        Math.min(0.25, planner.legLength * 0.3)
      )
        return false
      const yaw = new THREE.Quaternion().setFromAxisAngle(up, pose.heading)
      for (const [index, leg] of planner.legs.entries()) {
        const hip = leg.hipOffset
          .clone()
          .applyQuaternion(planner.reference)
          .applyQuaternion(yaw)
          .add(pose.root)
        const reach = hip.distanceTo(pose.contacts[index].position)
        const length = leg.upperLength + leg.lowerLength
        if (reach > length + 0.0008 || reach < length * 0.55) return false
        const twist = Math.abs(
          pose.heading - planner.footHeading(index, pose.contacts[index], pose.heading),
        )
        if (twist > planner.twistLimit + 0.02) return false
      }
      if (
        supportsOverlap(
          planner.footprint(0, pose.contacts[0]),
          planner.footprint(1, pose.contacts[1]),
          0,
        )
      )
        return false
    }
    return true
  }
}

export function planPivotTurn(
  state: TurnPlanningState,
  planner: ProceduralTurnPlanner,
  direction: number,
  front: number,
): PivotTurnPlan | null {
  // A pivot acquires the forefoot from balanced double support. The ordinary
  // step planner handles other entry poses and explicitly slow requests.
  if (!state.grounded.every(Boolean)) return null
  const eligible: PivotTurnPlan[] = []
  for (const stance of [0, 1]) {
    for (const transfer of [0.62, 0.74, 0.84, 0.88, 0.92]) {
      const spin = 2.16 / planner.tempo
      for (const depth of [0.04, 0.06, 0.08]) {
        const plan = new PivotTurnPlan(
          stance,
          state,
          planner,
          direction,
          front,
          transfer,
          spin,
          planner.legLength * depth,
        )
        if (plan.end <= 3.8 && plan.feasible()) {
          eligible.push(plan)
          break
        }
      }
      if (eligible.at(-1)?.stance === stance) break
    }
  }
  return (
    eligible.sort(
      (a, b) =>
        a.end - b.end ||
        a.anchor.distanceToSquared(state.root) - b.anchor.distanceToSquared(state.root),
    )[0] ?? null
  )
}
