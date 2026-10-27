import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import {
  type BodyTurnIntent,
  bodyTurnIntentSchema,
  type MotionPhaseId,
} from '../../../../shared/motion'
import type { MotionOutcome } from '../../MotionPhaseExecution'
import {
  ProceduralTurnPlanner,
  type TurnPlanningState,
  type TurnStepPlan,
} from './ProceduralTurnPlanner'
import { plantLeg } from './plantLeg'

const up = new THREE.Vector3(0, 1, 0)
interface Foot {
  upper: THREE.Object3D
  lower: THREE.Object3D
  foot: THREE.Object3D
  target: THREE.Vector3
  orientation: THREE.Quaternion
  support: boolean
}
interface Forecast {
  state: TurnPlanningState
  goal: number
  search: Generator<void, TurnStepPlan | null>
  result: TurnStepPlan | null | undefined
  target: TurnStepPlan | null
}

/** The existing final body executor consumes one pose-adaptive horizon at a time.
 * A contact is committed only after FK/IK verification at the actual landing.
 */
export class TurnInPlaceMotion {
  readonly intent: BodyTurnIntent
  readonly feet: Foot[]
  readonly planner: ProceduralTurnPlanner
  phase: MotionPhaseId = 'prepare'
  outcome: MotionOutcome | null = null
  heading = 0
  elapsed = 0
  phaseElapsed = 0
  maxSupportDrift = 0
  contactReleases = 0
  private readonly hips: THREE.Object3D
  private readonly initialStage: THREE.Quaternion
  private readonly rootPosition: THREE.Vector3
  private readonly direction: number
  private readonly wallStarted = performance.now()
  private goal: number
  private interrupt: MotionOutcome | null = null
  private failed = false
  private plan: TurnStepPlan | null = null
  private lastSwing: number | null = null
  private angularVelocity = 0
  private angularAcceleration = 0
  private comVelocity = new THREE.Vector2()
  private comAcceleration = new THREE.Vector2()
  private observedHeading = 0
  private observedYaw = 0
  private previousRoot: THREE.Vector3
  private rootVelocity = new THREE.Vector3()
  private seconds = 1 / 60
  private previousSeconds = 1 / 60
  private maxRootSpeed = 0
  private maxRootAcceleration = 0
  private balanceMargin = Infinity
  private released = false
  private recovering = false
  private stabilizing = false
  private stabilized = false
  private retriedFromRest = false
  private forecast: Forecast | null = null
  private minimumBalanceMargin = Infinity
  private maxSearchSliceMs = 0
  private forecastMisses = 0

  constructor(
    private readonly vrm: VRM,
    request: BodyTurnIntent,
    _seed: number,
    private readonly baseHeading = 0,
  ) {
    this.intent = bodyTurnIntentSchema.parse(request)
    const hips = vrm.humanoid.getNormalizedBoneNode('hips')
    if (!hips) throw new Error('ARDY_RIG_UNSUPPORTED')
    this.hips = hips
    vrm.scene.updateMatrixWorld(true)
    this.initialStage = vrm.scene.quaternion.clone()
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(
      vrm.scene.getWorldQuaternion(new THREE.Quaternion()),
    )
    this.observedYaw = Math.atan2(front.x, front.z)
    this.rootPosition = hips.getWorldPosition(new THREE.Vector3())
    this.previousRoot = this.rootPosition.clone()
    this.direction = request.direction === 'clockwise' ? -1 : 1
    this.goal = this.direction * Math.PI * 2
    this.feet = (['left', 'right'] as const).map((side) => {
      const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`)
      const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`)
      const foot = vrm.humanoid.getNormalizedBoneNode(`${side}Foot`)
      if (!upper || !lower || !foot) throw new Error('ARDY_RIG_UNSUPPORTED')
      return {
        upper,
        lower,
        foot,
        target: foot.getWorldPosition(new THREE.Vector3()),
        orientation: foot.getWorldQuaternion(new THREE.Quaternion()),
        support: true,
      }
    })
    this.planner = new ProceduralTurnPlanner(vrm, request.tempo)
    const floor = Math.min(...this.feet.map((foot) => foot.target.y))
    for (const foot of this.feet)
      foot.support = foot.target.y <= floor + this.planner.legLength * 0.015
    this.selectPlan()
  }

  get preparationProgress(): number {
    return this.phase === 'prepare' && this.plan
      ? Math.min(1, (this.elapsed - this.plan.start) / this.plan.transferDuration)
      : 1
  }

  requestStop(outcome: 'cancelled' | 'superseded' = 'cancelled'): void {
    if (!this.interrupt) {
      this.interrupt = outcome
      this.forecast = null
      this.stabilized = false
      if (this.plan) this.plan.continuation = undefined
    }
  }

  private pumpSearch(): void {
    const forecast = this.forecast
    if (!forecast || forecast.result !== undefined) return
    const deadline = performance.now() + 2
    const started = performance.now()
    for (let count = 0; count < 1024 && performance.now() < deadline; count++) {
      const next = forecast.search.next()
      if (next.done) {
        forecast.result = next.value
        if (forecast.target) {
          forecast.target.continuation = next.value
          // Keep only the current horizon and two future contacts. The next
          // step was feasibility-checked, but its own tail is recomputed later.
          if (next.value) next.value.continuation = undefined
          if (this.plan) this.forecast = null
        }
        break
      }
    }
    this.maxSearchSliceMs = Math.max(this.maxSearchSliceMs, performance.now() - started)
  }

  private forecastFrom(plan: TurnStepPlan): void {
    if (this.recovering) {
      this.forecast = null
      return
    }
    const target = plan
    if (this.forecast?.target === target) return
    const pose = target.sample(target.end)
    const state: TurnPlanningState = {
      at: target.end,
      heading: pose.heading,
      angularVelocity: pose.angularVelocity,
      angularAcceleration: pose.angularAcceleration,
      root: pose.root,
      contacts: pose.contacts,
      grounded: [true, true],
      lastSwing: target.swing ?? plan.swing ?? this.lastSwing,
      comVelocity: pose.comVelocity,
      comAcceleration: pose.comAcceleration,
    }
    const goal = this.interrupt
      ? Math.round((this.baseHeading + pose.heading) / (Math.PI * 2)) * Math.PI * 2 -
        this.baseHeading
      : this.goal
    this.forecast = {
      state,
      goal,
      search: this.planner.search(state, goal),
      result: undefined,
      target,
    }
  }

  private matchesPlan(plan: TurnStepPlan, state: TurnPlanningState): boolean {
    const pose = plan.sample(plan.start)
    return (
      Math.abs(plan.start - state.at) < 1e-6 &&
      Math.abs(pose.heading - state.heading) < 1e-5 &&
      pose.root.distanceTo(state.root) < 0.0005 &&
      state.contacts.every(
        (foot, index) =>
          foot.position.distanceTo(pose.contacts[index].position) < 0.0005 &&
          foot.orientation.angleTo(pose.contacts[index].orientation) < 0.001,
      )
    )
  }

  private matchesForecast(state: TurnPlanningState): boolean {
    const forecast = this.forecast
    return (
      !!forecast &&
      Math.abs(forecast.goal - this.goal) < 1e-8 &&
      Math.abs(forecast.state.at - state.at) < 1e-6 &&
      Math.abs(forecast.state.heading - state.heading) < 1e-5 &&
      forecast.state.root.distanceTo(state.root) < 0.0005 &&
      state.contacts.every(
        (foot, index) =>
          foot.position.distanceTo(forecast.state.contacts[index].position) < 0.0005 &&
          foot.orientation.angleTo(forecast.state.contacts[index].orientation) < 0.001,
      )
    )
  }

  private state(): TurnPlanningState {
    return {
      at: this.elapsed,
      heading: this.heading,
      angularVelocity: this.angularVelocity,
      angularAcceleration: this.angularAcceleration,
      root: this.hips.getWorldPosition(new THREE.Vector3()),
      contacts: this.feet.map((foot) => ({
        position: foot.target.clone(),
        orientation: foot.orientation.clone(),
      })),
      lastSwing: this.lastSwing,
      comVelocity: this.comVelocity.clone(),
      comAcceleration: this.comAcceleration.clone(),
      grounded: this.feet.map((foot) => foot.support),
    }
  }

  private selectPlan(): void {
    if (this.interrupt && !this.failed)
      this.goal =
        Math.round((this.baseHeading + this.heading) / (2 * Math.PI)) * 2 * Math.PI -
        this.baseHeading
    const state = this.state()
    if (this.interrupt && !this.failed && !this.stabilized) {
      this.plan = this.planner.recovery(state, false)
      this.stabilizing = true
      this.phase = 'recover'
    } else if (this.failed || this.planner.settled(state, this.goal)) {
      this.plan = this.planner.recovery(state)
      this.recovering = true
      this.phase = 'recover'
    } else {
      if (this.plan?.continuation && this.matchesPlan(this.plan.continuation, state))
        this.plan = this.plan.continuation
      else if (this.matchesForecast(state) && this.forecast?.result !== undefined)
        this.plan = this.forecast.result
      else if (
        this.matchesForecast(state) &&
        Math.abs(this.angularVelocity) < 1e-6 &&
        this.comVelocity.length() < 1e-6
      ) {
        this.plan = null
        return
      } else if (this.elapsed === 0 && this.contactReleases === 0) {
        this.forecast ??= {
          state,
          goal: this.goal,
          search: this.planner.search(state, this.goal),
          result: undefined,
          target: null,
        }
        this.plan = null
        return
      } else {
        // A missed/mismatched forecast grants no contact or execution credit.
        // Brake continuously in verified double support and forecast from there.
        this.plan = this.planner.recovery(state, false)
        this.forecastMisses++
        this.stabilizing = true
        this.phase = 'recover'
      }
      this.phase = this.interrupt ? 'recover' : this.contactReleases ? 'stroke' : 'prepare'
    }
    this.phaseElapsed = 0
    this.released = false
    if (!this.plan && !this.failed && !this.retriedFromRest) {
      // Reversal or a small final placement may be infeasible with the current
      // COM momentum. Brake in double support, then solve again from rest.
      this.plan = this.planner.recovery(state, false)
      this.stabilizing = true
      this.retriedFromRest = true
      this.phase = 'recover'
    }
    if (!this.plan) {
      this.failed = true
      this.interrupt ??= 'failed'
      this.recovering = true
      this.phase = 'recover'
      this.plan = this.planner.recovery(state)
      if (!this.plan) this.outcome = 'failed'
    }
    if (this.plan) this.forecastFrom(this.plan)
  }

  advance(seconds: number): void {
    if (this.outcome) return
    this.composeRoot()
    this.pumpSearch()
    if (!this.plan) {
      if (!this.interrupt && this.forecast?.result === undefined) return
      this.selectPlan()
      if (!this.plan || this.outcome) return
    }
    let remaining = Math.max(0, Math.min(0.05, seconds))
    this.seconds = remaining
    if (
      performance.now() - this.wallStarted > 45000 ||
      this.elapsed > 40 ||
      this.contactReleases >= 24
    ) {
      this.interrupt = 'timed-out'
      this.failed = true
    }
    for (let segment = 0; remaining > 1e-10 && segment < 8 && !this.outcome; segment++) {
      const plan = this.plan
      if (!plan) break
      const used = Math.min(remaining, Math.max(0, plan.end - this.elapsed))
      this.elapsed += used
      this.phaseElapsed += used
      remaining -= used
      const pose = plan.sample(this.elapsed)
      this.heading = pose.heading
      this.angularVelocity = pose.angularVelocity
      this.angularAcceleration = pose.angularAcceleration
      this.comVelocity.copy(pose.comVelocity)
      this.comAcceleration.copy(pose.comAcceleration)
      this.rootPosition.copy(pose.root)
      this.balanceMargin = pose.balanceMargin
      this.minimumBalanceMargin = Math.min(this.minimumBalanceMargin, pose.balanceMargin)
      for (const [index, foot] of this.feet.entries()) {
        foot.target.copy(pose.contacts[index].position)
        foot.orientation.copy(pose.contacts[index].orientation)
        foot.support = pose.support[index]
      }
      if (
        !this.released &&
        plan.swing !== null &&
        this.elapsed > plan.start + plan.transferDuration
      ) {
        this.released = true
        this.contactReleases++
        if (!this.interrupt) this.phase = 'stroke'
      }
      this.composeRoot()
      const valid = this.solveLegs()
      if (!valid) {
        this.failed = true
        this.interrupt ??= 'failed'
      }
      if (this.elapsed < plan.end - 1e-9) break
      // Verify the actual landing before acquiring it. Preserve elapsed remainder.
      if (this.recovering) {
        this.outcome = valid
          ? this.failed
            ? this.interrupt === 'timed-out'
              ? 'timed-out'
              : 'failed'
            : (this.interrupt ?? 'completed')
          : 'failed'
        break
      }
      if (this.stabilizing) {
        this.stabilizing = false
        this.stabilized = true
      }
      this.lastSwing = plan.swing ?? this.lastSwing
      if (plan.swing !== null) this.retriedFromRest = false
      for (const foot of this.feet) {
        foot.target.copy(foot.foot.getWorldPosition(new THREE.Vector3()))
        foot.orientation.copy(foot.foot.getWorldQuaternion(new THREE.Quaternion()))
        foot.support = true
      }
      this.selectPlan()
    }
  }

  private composeRoot(): void {
    this.vrm.scene.quaternion
      .copy(this.initialStage)
      .premultiply(new THREE.Quaternion().setFromAxisAngle(up, this.heading))
    this.vrm.scene.updateMatrixWorld(true)
    const local = this.rootPosition.clone()
    this.hips.parent?.worldToLocal(local)
    this.hips.position.copy(local)
    this.vrm.scene.updateMatrixWorld(true)
  }

  restorePlannedRoot(): void {
    this.composeRoot()
  }

  getPlanningDebug() {
    return {
      minimumBalanceMarginM: Number.isFinite(this.minimumBalanceMargin)
        ? this.minimumBalanceMargin
        : null,
      maxSearchSliceMs: this.maxSearchSliceMs,
      forecastMisses: this.forecastMisses,
      plansSelected: this.planner.plansSelected,
      candidatesEvaluated: this.planner.candidatesEvaluated,
    }
  }

  private solveLegs(): boolean {
    let valid = this.balanceMargin >= -0.001
    for (const leg of this.feet) {
      const pole = new THREE.Vector3(
        0,
        0,
        this.vrm.meta.metaVersion === '0' ? -1 : 1,
      ).applyQuaternion(leg.orientation)
      plantLeg(leg.upper, leg.lower, leg.foot, leg.target, leg.orientation, pole)
      const error = leg.foot.getWorldPosition(new THREE.Vector3()).distanceTo(leg.target)
      if (leg.support) this.maxSupportDrift = Math.max(this.maxSupportDrift, error)
      valid &&=
        error <= 0.003 &&
        leg.foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(leg.orientation) < 0.03
      const a = leg.upper
        .getWorldPosition(new THREE.Vector3())
        .sub(leg.lower.getWorldPosition(new THREE.Vector3()))
      const b = leg.foot
        .getWorldPosition(new THREE.Vector3())
        .sub(leg.lower.getWorldPosition(new THREE.Vector3()))
      valid &&= Math.PI - a.angleTo(b) <= 2.45
    }
    return valid
  }

  solveAndVerify(contactsClear: boolean): void {
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(
      this.vrm.scene.getWorldQuaternion(new THREE.Quaternion()),
    )
    const angle = Math.atan2(front.x, front.z)
    this.observedHeading += Math.atan2(
      Math.sin(angle - this.observedYaw),
      Math.cos(angle - this.observedYaw),
    )
    this.observedYaw = angle
    const root = this.hips.getWorldPosition(new THREE.Vector3())
    if (this.seconds > 1e-8) {
      const velocity = root.clone().sub(this.previousRoot).divideScalar(this.seconds)
      velocity.y = 0
      this.maxRootSpeed = Math.max(this.maxRootSpeed, velocity.length())
      this.maxRootAcceleration = Math.max(
        this.maxRootAcceleration,
        velocity.clone().sub(this.rootVelocity).length() /
          ((this.seconds + this.previousSeconds) / 2),
      )
      this.rootVelocity.copy(velocity)
      this.previousRoot.copy(root)
      this.previousSeconds = this.seconds
    }
    const valid = contactsClear && root.distanceTo(this.rootPosition) < 0.005 && this.solveLegs()
    if (!valid) {
      this.failed = true
      this.interrupt ??= 'failed'
      if (this.outcome) this.outcome = 'failed'
    }
    if (
      this.outcome === 'completed' &&
      Math.abs(this.observedHeading - this.direction * Math.PI * 2) >= 0.002
    )
      this.outcome = 'failed'
  }

  getStage() {
    return {
      position: this.vrm.scene.position.toArray(),
      orientation: this.vrm.scene.quaternion.toArray(),
      continuousHeading: this.baseHeading + this.observedHeading,
      generator: 'procedural' as const,
    }
  }
  getStatus() {
    return {
      generator: 'procedural' as const,
      direction: this.intent.direction,
      actionHeading: this.observedHeading,
      support: this.feet.every((foot) => foot.support)
        ? ('double' as const)
        : this.feet[0].support
          ? ('left' as const)
          : ('right' as const),
      steps: this.contactReleases,
      maxRootSpeedMps: this.maxRootSpeed,
      maxRootAccelerationMps2: this.maxRootAcceleration,
      maxSupportDriftM: this.maxSupportDrift,
      outcome: this.outcome,
    }
  }
}
