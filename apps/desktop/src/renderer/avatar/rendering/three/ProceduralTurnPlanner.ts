import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import { MotionCurve } from './MotionCurve'
import {
  closestSupportPoint,
  supportHull,
  supportMargin,
  supportsOverlap,
} from './TurnSupportGeometry'

const up = new THREE.Vector3(0, 1, 0)
const yaw = (angle: number) => new THREE.Quaternion().setFromAxisAngle(up, angle)
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const smooth = (u: number) => u * u * u * (10 + u * (-15 + 6 * u))
interface AngularPath {
  sample(at: number): { position: number; velocity: number; acceleration: number }
}
class ContactHeadingPath implements AngularPath {
  constructor(
    private readonly transfer: MotionCurve,
    private readonly swing: MotionCurve,
  ) {}
  sample(at: number) {
    return at < this.swing.start ? this.transfer.sample(at) : this.swing.sample(at)
  }
}
export interface TurnContact {
  position: THREE.Vector3
  orientation: THREE.Quaternion
}
export interface TurnLegGeometry {
  hipOffset: THREE.Vector3
  upperLength: number
  lowerLength: number
  sole: THREE.Vector3[]
  restOrientation: THREE.Quaternion
  restOffset: THREE.Vector3
}
export interface TurnPlanningState {
  at: number
  heading: number
  angularVelocity: number
  angularAcceleration: number
  root: THREE.Vector3
  contacts: readonly TurnContact[]
  lastSwing: number | null
  comVelocity: THREE.Vector2
  comAcceleration: THREE.Vector2
  grounded: readonly boolean[]
}
export interface TurnPlanSample {
  heading: number
  angularVelocity: number
  angularAcceleration: number
  root: THREE.Vector3
  contacts: TurnContact[]
  support: readonly boolean[]
  zmp: THREE.Vector2
  balanceMargin: number
  comVelocity: THREE.Vector2
  comAcceleration: THREE.Vector2
}

/** One feasible, transient horizon. A new landing invalidates all candidates.
 * Curves interpolate the selected solution; they do not prescribe a step count.
 */
export class TurnStepPlan {
  readonly end: number
  continuation: TurnStepPlan | null | undefined
  constructor(
    readonly start: number,
    readonly duration: number,
    readonly transferDuration: number,
    readonly swing: number | null,
    readonly from: readonly TurnContact[],
    readonly grounded: readonly boolean[],
    readonly to: TurnContact,
    readonly heading: AngularPath,
    readonly comX: AngularPath,
    readonly comZ: AngularPath,
    readonly crouch: MotionCurve,
    readonly arc: THREE.Vector3,
    readonly lift: number,
    private readonly planner: ProceduralTurnPlanner,
    readonly cost: number,
  ) {
    this.end = start + duration
  }

  sample(at: number): TurnPlanSample {
    const h = this.heading.sample(at)
    const x = this.comX.sample(at),
      z = this.comZ.sample(at)
    const root = new THREE.Vector3(
      x.position,
      this.planner.rootHeight - this.crouch.sample(at).position ** 2,
      z.position,
    )
    root.sub(this.planner.comOffset.clone().applyQuaternion(yaw(h.position)))
    // COM curves specify horizontal position; the height curve specifies hips.
    root.y = this.planner.rootHeight - this.crouch.sample(at).position ** 2
    const contacts = this.from.map((foot) => ({
      position: foot.position.clone(),
      orientation: foot.orientation.clone(),
    }))
    const support = [...this.grounded]
    if (this.swing !== null) {
      const u = THREE.MathUtils.clamp(
        (at - this.start - this.transferDuration) / (this.duration - this.transferDuration),
        0,
        1,
      )
      const blend = smooth(u),
        bell = 64 * (u * (1 - u)) ** 3
      contacts[this.swing].position.lerp(this.to.position, blend).addScaledVector(this.arc, bell)
      contacts[this.swing].position.y += bell * this.lift
      contacts[this.swing].orientation.slerp(this.to.orientation, blend)
      support[this.swing] = (this.grounded[this.swing] && u <= 1e-9) || u >= 1 - 1e-9
    }
    const polygons = contacts.flatMap((foot, index) =>
      support[index] ? this.planner.footprint(index, foot) : [],
    )
    const hull = supportHull(polygons)
    // Linear inverted-pendulum proxy: zmp = com - height/g * com acceleration.
    const height = Math.max(0.1, root.y + this.planner.comOffset.y - this.planner.floor)
    const zmp = new THREE.Vector2(
      x.position - (height / 9.81) * x.acceleration,
      z.position - (height / 9.81) * z.acceleration,
    )
    return {
      heading: h.position,
      angularVelocity: h.velocity,
      angularAcceleration: h.acceleration,
      root,
      contacts,
      support,
      zmp,
      balanceMargin: supportMargin(zmp, hull),
      comVelocity: new THREE.Vector2(x.velocity, z.velocity),
      comAcceleration: new THREE.Vector2(x.acceleration, z.acceleration),
    }
  }
}

/** Pose-adaptive finite candidate search owned by the existing Body Domain.
 * No clock, bone writes, source sampling, semantic choices or external authority.
 */
export class ProceduralTurnPlanner {
  readonly legs: readonly TurnLegGeometry[]
  readonly rootHeight: number
  readonly comOffset: THREE.Vector3
  readonly floor: number
  readonly centre: THREE.Vector3
  readonly legLength: number
  readonly twistLimit: number
  readonly reference: THREE.Quaternion
  candidatesEvaluated = 0
  plansSelected = 0
  readonly rejected: Record<string, number> = {}
  private readonly minimumGap: number

  constructor(
    vrm: VRM,
    readonly tempo: number,
  ) {
    const hips = vrm.humanoid.getNormalizedBoneNode('hips')
    if (!hips) throw new Error('ARDY_RIG_UNSUPPORTED')
    vrm.scene.updateMatrixWorld(true)
    const root = hips.getWorldPosition(new THREE.Vector3())
    this.reference = vrm.scene.getWorldQuaternion(new THREE.Quaternion())
    const inverse = this.reference.clone().invert()
    this.rootHeight = root.y
    // Explicit geometric proxy, not inferred mass/inertia data. Preserve the
    // current torso lean and asymmetric arm load in the initial support decision.
    const points = [
      ['hips', 0.5],
      ['chest', 0.22],
      ['head', 0.08],
      ['leftUpperArm', 0.04],
      ['rightUpperArm', 0.04],
      ['leftLowerLeg', 0.06],
      ['rightLowerLeg', 0.06],
    ] as const
    const com = new THREE.Vector3()
    let weight = 0
    for (const [name, mass] of points) {
      const bone = vrm.humanoid.getNormalizedBoneNode(name)
      if (bone) {
        com.addScaledVector(bone.getWorldPosition(new THREE.Vector3()), mass)
        weight += mass
      }
    }
    this.comOffset = com.divideScalar(weight).sub(root)
    this.legs = (['left', 'right'] as const).map((side) => {
      const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`)
      const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`)
      const foot = vrm.humanoid.getNormalizedBoneNode(`${side}Foot`)
      if (!upper || !lower || !foot) throw new Error('ARDY_RIG_UNSUPPORTED')
      const hip = upper.getWorldPosition(new THREE.Vector3()),
        knee = lower.getWorldPosition(new THREE.Vector3()),
        ankle = foot.getWorldPosition(new THREE.Vector3())
      const length = hip.distanceTo(knee) + knee.distanceTo(ankle)
      const orientation = this.reference.clone()
      const toe = vrm.humanoid.getNormalizedBoneNode(`${side}Toes`)
      const toeDistance = toe
        ? toe.getWorldPosition(new THREE.Vector3()).distanceTo(ankle)
        : length * 0.12
      const sole = this.measureSole(vrm, side, ankle, orientation, length, toeDistance)
      return {
        hipOffset: hip.clone().sub(root).applyQuaternion(inverse),
        upperLength: hip.distanceTo(knee),
        lowerLength: knee.distanceTo(ankle),
        sole,
        restOrientation: orientation,
        restOffset: ankle.clone().sub(root).applyQuaternion(inverse),
      }
    })
    this.legLength = Math.min(...this.legs.map((leg) => leg.upperLength + leg.lowerLength))
    if (this.legLength < 0.15 || this.legLength > 2.5) throw new Error('ARDY_RIG_UNSUPPORTED')
    this.floor = Math.min(...this.legs.map((leg) => root.y + leg.restOffset.y))
    this.centre = root.clone()
    this.centre.y = this.floor
    const hipWidth = this.legs[0].hipOffset.distanceTo(this.legs[1].hipOffset)
    const actualWidth = Math.abs(this.legs[0].restOffset.x - this.legs[1].restOffset.x)
    const halfWidth = THREE.MathUtils.clamp(actualWidth / 2, hipWidth * 0.45, this.legLength * 0.2)
    for (const [index, leg] of this.legs.entries()) {
      const sign = Math.sign(leg.hipOffset.x) || (index ? 1 : -1)
      leg.restOffset.x = sign * halfWidth
      leg.restOffset.y = this.floor - root.y
      leg.restOffset.z = THREE.MathUtils.clamp(
        leg.restOffset.z,
        -this.legLength * 0.12,
        this.legLength * 0.12,
      )
    }
    this.minimumGap = Math.min(hipWidth * 0.1, this.legLength * 0.018)
    // Anatomical policy is bounded; measured stance and leg proportions reduce
    // the usable twist envelope rather than supplying a prescribed angle list.
    this.twistLimit = THREE.MathUtils.clamp(
      Math.atan2(this.legLength, Math.max(hipWidth, halfWidth * 2)) * 0.52,
      0.42,
      0.72,
    )
  }

  private measureSole(
    vrm: VRM,
    side: 'left' | 'right',
    ankle: THREE.Vector3,
    orientation: THREE.Quaternion,
    length: number,
    toeDistance: number,
  ): THREE.Vector3[] {
    const raw = vrm.humanoid.getRawBoneNode(`${side}Foot`)
    const toes = vrm.humanoid.getRawBoneNode(`${side}Toes`)
    const bounds = new THREE.Box3()
    const inverse = orientation.clone().invert()
    let count = 0
    vrm.scene.traverse((node) => {
      if (!(node instanceof THREE.SkinnedMesh)) return
      const weights = node.geometry.getAttribute('skinWeight'),
        indices = node.geometry.getAttribute('skinIndex'),
        position = node.geometry.getAttribute('position')
      if (!weights || !indices || !position) return
      node.skeleton.update()
      const owned = new Set(
        node.skeleton.bones.flatMap((bone, index) =>
          bone === raw || bone === toes ? [index] : [],
        ),
      )
      if (!owned.size) return
      for (
        let sample = 0;
        sample < position.count;
        sample += Math.max(1, Math.ceil(position.count / 4096))
      ) {
        let influence = 0
        for (let axis = 0; axis < 4; axis++)
          if (owned.has(indices.getComponent(sample, axis)))
            influence += weights.getComponent(sample, axis)
        if (influence < 0.6) continue
        const p = node
          .getVertexPosition(sample, new THREE.Vector3())
          .applyMatrix4(node.matrixWorld)
          .sub(ankle)
          .applyQuaternion(inverse)
        if (p.length() > length * 0.4) continue
        bounds.expandByPoint(p)
        count++
      }
    })
    const sign = vrm.meta.metaVersion === '0' ? -1 : 1
    // Missing skin uses a documented skeletal contact proxy, never a global
    // shoe size. Measured shoes are bounded to avoid decorative mesh authority.
    const halfWidth =
      count >= 8
        ? THREE.MathUtils.clamp(
            (bounds.max.x - bounds.min.x) * 0.42,
            length * 0.025,
            length * 0.075,
          )
        : length * 0.045
    const centreX = count >= 8 ? (bounds.max.x + bounds.min.x) / 2 : 0
    const near =
      count >= 8
        ? THREE.MathUtils.clamp(bounds.min.z * 0.85, -length * 0.24, -length * 0.035)
        : Math.min(-length * 0.045, sign * toeDistance * 1.25)
    const far =
      count >= 8
        ? THREE.MathUtils.clamp(bounds.max.z * 0.85, length * 0.035, length * 0.24)
        : Math.max(length * 0.045, sign * toeDistance * 1.25)
    return [
      [-halfWidth, near],
      [halfWidth, near],
      [halfWidth, far],
      [-halfWidth, far],
    ].map(([x, z]) => new THREE.Vector3(x + centreX, 0, z))
  }

  footprint(index: number, foot: TurnContact): THREE.Vector2[] {
    return supportHull(
      this.legs[index].sole.map((corner) => {
        const p = corner.clone().applyQuaternion(foot.orientation).add(foot.position)
        return new THREE.Vector2(p.x, p.z)
      }),
    )
  }

  footHeading(index: number, foot: TurnContact, near: number): number {
    const q = foot.orientation.clone().multiply(this.legs[index].restOrientation.clone().invert())
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
    const angle = Math.atan2(direction.x, direction.z)
    return near + wrap(angle - near)
  }

  desiredContact(index: number, heading: number, width = 1): TurnContact {
    const offset = this.legs[index].restOffset.clone()
    offset.x *= width
    // Rest offsets are rig local, then oriented through the original stage.
    offset.applyQuaternion(this.reference).applyQuaternion(yaw(heading))
    offset.y = this.floor - this.rootHeight
    return {
      position: new THREE.Vector3(this.centre.x, this.rootHeight, this.centre.z).add(offset),
      orientation: yaw(heading).multiply(this.legs[index].restOrientation),
    }
  }

  settled(state: TurnPlanningState, goal: number): boolean {
    return (
      Math.abs(state.heading - goal) < 0.002 &&
      Math.abs(state.angularVelocity) < 0.015 &&
      state.contacts.every((foot, index) => {
        const desired = this.desiredContact(index, goal)
        return (
          foot.position.distanceTo(desired.position) < this.legLength * 0.025 &&
          foot.orientation.angleTo(desired.orientation) < 0.035
        )
      })
    )
  }

  plan(state: TurnPlanningState, goal: number): TurnStepPlan | null {
    const search = this.search(state, goal)
    let next = search.next()
    while (!next.done) next = search.next()
    return next.value
  }

  *search(
    state: TurnPlanningState,
    goal: number,
    lookahead = true,
  ): Generator<void, TurnStepPlan | null> {
    const direction = Math.sign(goal - state.heading)
    const remaining = Math.abs(goal - state.heading)
    let best: TurnStepPlan | null = null
    const candidates: TurnStepPlan[] = []
    if (lookahead) this.candidatesEvaluated = 0
    for (const swing of [0, 1]) {
      const support = 1 - swing
      if (!state.grounded[support]) continue
      const stanceHeading = this.footHeading(support, state.contacts[support], state.heading)
      const available = Math.max(
        0,
        this.twistLimit * 0.7 + direction * (stanceHeading - state.heading),
      )
      const progresses =
        remaining < 0.002
          ? [0]
          : [1, 0.75, 0.5].map((fraction) => Math.min(remaining, available * fraction))
      for (const progress of progresses) {
        if (remaining > 0.002 && progress < 0.08 && remaining > 0.08) continue
        const endHeading = state.heading + direction * progress
        const leads =
          remaining <= progress + 0.002
            ? [0]
            : [0, 0.5, 0.8].map((value) => direction * this.twistLimit * value)
        for (const lead of leads)
          for (const width of remaining < 0.002 ? [1] : [1, 1.12, 1.3]) {
            const target = this.desiredContact(swing, endHeading + lead, width)
            const travel = state.contacts[swing].position.distanceTo(target.position)
            const turn = state.contacts[swing].orientation.angleTo(target.orientation)
            if (travel < this.legLength * 0.008 && turn < 0.025) continue
            if (travel > this.legLength * 0.65 || turn > 2.4) continue
            const stancePolygon = this.footprint(support, state.contacts[support])
            if (supportsOverlap(stancePolygon, this.footprint(swing, target), this.minimumGap))
              continue
            const currentCom = state.root
              .clone()
              .add(this.comOffset.clone().applyQuaternion(yaw(state.heading)))
            const supportPoint = closestSupportPoint(
              new THREE.Vector2(this.centre.x, this.centre.z),
              stancePolygon,
              this.legLength * 0.012,
            )
            const distance = supportPoint.distanceTo(new THREE.Vector2(currentCom.x, currentCom.z))
            const swingTime =
              Math.max(
                0.48,
                Math.sqrt((5.8 * travel) / 2),
                Math.sqrt((5.8 * turn) / 15),
                Math.sqrt((5.8 * progress) / 4),
              ) / this.tempo
            const transferTime = Math.max(0.28, Math.sqrt((5.8 * distance) / 2.5)) / this.tempo
            for (const timeScale of [1, 1.35, 1.8, 2.4, 3.2, 4.2]) {
              const transfer = transferTime * timeScale,
                duration = transfer + swingTime
              const endVelocity =
                remaining <= progress + 0.002
                  ? 0
                  : direction *
                    Math.min(
                      0.6 * this.tempo,
                      progress / duration,
                      (Math.max(0, this.twistLimit - direction * (endHeading - stanceHeading)) /
                        Math.max(0.5, transfer)) *
                        0.45,
                    )
              const swingHeading = this.footHeading(swing, state.contacts[swing], state.heading)
              const doubleSlack = Math.max(
                0,
                this.twistLimit + direction * (swingHeading - state.heading),
              )
              const preProgress = Math.min(
                progress,
                doubleSlack * 0.65,
                Math.max(progress * 0.4, Math.abs(state.angularVelocity) * transfer * 0.5),
              )
              const handoffVelocity =
                direction *
                Math.min(
                  0.7 * this.tempo,
                  (preProgress / transfer) * 1.3,
                  ((progress - preProgress) / swingTime) * 1.5,
                )
              const firstHeading = new MotionCurve(
                state.at,
                transfer,
                state.heading,
                state.heading + direction * preProgress,
                state.angularVelocity,
                state.angularAcceleration,
                handoffVelocity,
              )
              const heading = new ContactHeadingPath(
                firstHeading,
                new MotionCurve(
                  state.at + transfer,
                  swingTime,
                  state.heading + direction * preProgress,
                  endHeading,
                  handoffVelocity,
                  0,
                  endVelocity,
                ),
              )
              for (const carrySpeed of [0.08, 0.04, 0]) {
                const speed =
                  carrySpeed *
                  this.legLength *
                  this.tempo *
                  Math.min(1, remaining / this.twistLimit)
                const entry = supportPoint
                  .clone()
                  .sub(new THREE.Vector2(currentCom.x, currentCom.z))
                  .normalize()
                  .multiplyScalar(speed)
                const exit = new THREE.Vector2(target.position.x, target.position.z)
                  .sub(supportPoint)
                  .normalize()
                  .multiplyScalar(speed)
                const finish =
                  remaining < this.twistLimit || carrySpeed === 0
                    ? supportPoint
                    : closestSupportPoint(
                        new THREE.Vector2(target.position.x, target.position.z),
                        stancePolygon,
                        this.legLength * 0.016,
                      )
                const x = new ContactHeadingPath(
                  new MotionCurve(
                    state.at,
                    transfer,
                    currentCom.x,
                    supportPoint.x,
                    state.comVelocity.x,
                    state.comAcceleration.x,
                    entry.x,
                  ),
                  new MotionCurve(
                    state.at + transfer,
                    swingTime,
                    supportPoint.x,
                    finish.x,
                    entry.x,
                    0,
                    exit.x,
                  ),
                )
                const z = new ContactHeadingPath(
                  new MotionCurve(
                    state.at,
                    transfer,
                    currentCom.z,
                    supportPoint.y,
                    state.comVelocity.y,
                    state.comAcceleration.y,
                    entry.y,
                  ),
                  new MotionCurve(
                    state.at + transfer,
                    swingTime,
                    supportPoint.y,
                    finish.y,
                    entry.y,
                    0,
                    exit.y,
                  ),
                )
                const radial = target.position
                  .clone()
                  .add(state.contacts[swing].position)
                  .multiplyScalar(0.5)
                  .sub(state.contacts[support].position)
                radial.y = 0
                if (radial.lengthSq() < 1e-8) radial.copy(target.position).sub(this.centre)
                radial.normalize()
                for (const clearance of [0, 0.06, 0.12]) {
                  yield
                  this.candidatesEvaluated++
                  const cost =
                    (duration + (travel / this.legLength) * 0.35 + turn * 0.06 + clearance * 2) /
                      Math.max(progress, 0.3) +
                    (state.lastSwing === swing ? 0.25 : 0) +
                    (state.lastSwing === null ? (distance / this.legLength) * 8 : 0) +
                    (carrySpeed === 0 ? 0.12 : 0)
                  if (best && cost >= best.cost) continue
                  const arc = radial.clone().multiplyScalar(clearance * this.legLength)
                  const lift = Math.min(
                    this.legLength * 0.045,
                    this.legLength * 0.012 + travel * 0.22,
                  )
                  // Find a reachable height for this candidate before execution.
                  let depth = 0.001 * this.legLength
                  for (let sample = 0; sample <= 16; sample++) {
                    const at = state.at + (duration * sample) / 16
                    const h = heading.sample(at).position
                    const offset = this.comOffset.clone().applyQuaternion(yaw(h))
                    const rx = x.sample(at).position - offset.x,
                      rz = z.sample(at).position - offset.z
                    const u = THREE.MathUtils.clamp((at - state.at - transfer) / swingTime, 0, 1)
                    const foot = state.contacts[swing].position
                      .clone()
                      .lerp(target.position, smooth(u))
                      .addScaledVector(arc, 64 * (u * (1 - u)) ** 3)
                    foot.y += 64 * (u * (1 - u)) ** 3 * lift
                    for (const [index, leg] of this.legs.entries()) {
                      const hip = leg.hipOffset
                        .clone()
                        .applyQuaternion(this.reference)
                        .applyQuaternion(yaw(h))
                      const ankle = index === swing ? foot : state.contacts[index].position
                      const horizontal = Math.hypot(rx + hip.x - ankle.x, rz + hip.z - ankle.z)
                      const reach = leg.upperLength + leg.lowerLength - 0.0002
                      const allowed =
                        ankle.y +
                        Math.sqrt(Math.max(0, reach * reach - horizontal * horizontal)) -
                        hip.y
                      depth = Math.max(depth, this.rootHeight - allowed + 0.001)
                    }
                  }
                  if (depth > this.legLength * 0.09) continue
                  const crouch = new MotionCurve(
                    state.at,
                    transfer,
                    Math.sqrt(Math.max(0, this.rootHeight - state.root.y)),
                    Math.sqrt(depth),
                  )
                  const plan = new TurnStepPlan(
                    state.at,
                    duration,
                    transfer,
                    swing,
                    state.contacts,
                    state.grounded,
                    target,
                    heading,
                    x,
                    z,
                    crouch,
                    arc,
                    lift,
                    this,
                    cost,
                  )
                  if (
                    this.feasible(
                      plan,
                      state,
                      state.angularVelocity * direction >= -1e-6 ? direction : 0,
                    )
                  ) {
                    // Retain different landing configurations, not several timing
                    // variants of the same locally cheap but trapped placement.
                    const same = candidates.findIndex(
                      (candidate) =>
                        candidate.swing === plan.swing &&
                        candidate.to.position.distanceTo(plan.to.position) < 0.001 &&
                        candidate.to.orientation.angleTo(plan.to.orientation) < 0.005,
                    )
                    if (same < 0) candidates.push(plan)
                    else if (candidates[same].cost > plan.cost) candidates[same] = plan
                    candidates.sort((a, b) => a.cost - b.cost)
                    candidates.splice(6)
                    best = !lookahead
                      ? candidates[0]
                      : candidates.length >= 6
                        ? (candidates.at(-1) ?? null)
                        : null
                  }
                }
              }
            }
          }
      }
    }
    let chosen: TurnStepPlan | null = null,
      cost = Infinity
    for (const candidate of candidates) {
      if (!lookahead) return candidate
      const pose = candidate.sample(candidate.end)
      const next: TurnPlanningState = {
        at: candidate.end,
        heading: pose.heading,
        angularVelocity: pose.angularVelocity,
        angularAcceleration: pose.angularAcceleration,
        root: pose.root,
        contacts: pose.contacts,
        grounded: [true, true],
        lastSwing: candidate.swing,
        comVelocity: pose.comVelocity,
        comAcceleration: pose.comAcceleration,
      }
      const continuation = this.settled(next, goal)
        ? this.recovery(next)
        : yield* this.search(next, goal, false)
      if (!continuation) continue
      const combined = candidate.cost + continuation.cost * 0.3
      if (combined < cost) {
        cost = combined
        chosen = candidate
        chosen.continuation = continuation
      }
    }
    if (chosen) this.plansSelected++
    return chosen
  }

  recovery(state: TurnPlanningState, standing = true): TurnStepPlan | null {
    const hull = supportHull(state.contacts.flatMap((foot, index) => this.footprint(index, foot)))
    const centre = closestSupportPoint(
      new THREE.Vector2(this.centre.x + this.comOffset.x, this.centre.z + this.comOffset.z),
      hull,
      this.legLength * 0.01,
    )
    const com = state.root.clone().add(this.comOffset.clone().applyQuaternion(yaw(state.heading)))
    for (const duration of [0.8, 1.2, 1.8, 2.5]) {
      const plan = new TurnStepPlan(
        state.at,
        duration,
        duration,
        null,
        state.contacts,
        state.grounded,
        state.contacts[0],
        new MotionCurve(
          state.at,
          duration,
          state.heading,
          state.heading + (standing ? 0 : state.angularVelocity * duration * 0.5),
          state.angularVelocity,
          state.angularAcceleration,
        ),
        new MotionCurve(
          state.at,
          duration,
          com.x,
          centre.x,
          state.comVelocity.x,
          state.comAcceleration.x,
        ),
        new MotionCurve(
          state.at,
          duration,
          com.z,
          centre.y,
          state.comVelocity.y,
          state.comAcceleration.y,
        ),
        new MotionCurve(
          state.at,
          duration,
          Math.sqrt(Math.max(0, this.rootHeight - state.root.y)),
          standing ? 0 : Math.sqrt(Math.max(0, this.rootHeight - state.root.y)),
        ),
        new THREE.Vector3(),
        0,
        this,
        duration,
      )
      if (this.feasible(plan, state)) return plan
    }
    return null
  }

  private feasible(plan: TurnStepPlan, state: TurnPlanningState, direction = 0): boolean {
    const reject = (reason: string) => {
      this.rejected[reason] = (this.rejected[reason] ?? 0) + 1
      return false
    }
    for (let sample = 0; sample <= 32; sample++) {
      const pose = plan.sample(plan.start + (plan.duration * sample) / 32)
      if (direction * pose.angularVelocity < -1e-6) return reject('heading-reversal')
      if (pose.balanceMargin < -0.0005) return reject('balance')
      if (
        Math.abs(pose.angularVelocity) > 1.8 * this.tempo ||
        Math.abs(pose.angularAcceleration) > 4 * this.tempo ** 2
      )
        return reject('angular-dynamics')
      if (
        Math.hypot(pose.root.x - this.centre.x, pose.root.z - this.centre.z) >
        Math.min(0.25, this.legLength * 0.3)
      )
        return reject('root-envelope')
      for (const [index, leg] of this.legs.entries()) {
        const hip = leg.hipOffset
          .clone()
          .applyQuaternion(this.reference)
          .applyQuaternion(yaw(pose.heading))
          .add(pose.root)
        const reach = hip.distanceTo(pose.contacts[index].position),
          length = leg.upperLength + leg.lowerLength
        if (reach > length + 0.0008 || reach < length * 0.55) return reject('reach')
        const twist = Math.abs(
          wrap(pose.heading - this.footHeading(index, pose.contacts[index], pose.heading)),
        )
        // Swing can orient its foot freely, planted legs retain the twist bound.
        if (pose.support[index] && twist > this.twistLimit + 0.02) return reject('twist')
      }
      if (
        supportsOverlap(
          this.footprint(0, pose.contacts[0]),
          this.footprint(1, pose.contacts[1]),
          this.minimumGap,
        )
      )
        return reject('feet-overlap')
      // A candidate may brake, but cannot quietly make an extra full revolution.
      if (Math.abs(pose.heading - state.heading) > Math.PI / 2 + 0.1)
        return reject('heading-envelope')
    }
    return true
  }
}
