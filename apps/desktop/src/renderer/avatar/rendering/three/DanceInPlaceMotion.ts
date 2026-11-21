import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import type { BodyDanceIntent, MotionChunk, MotionPhaseId } from '../../../../shared/motion'
import type { MotionOutcome } from '../../MotionPhaseExecution'
import { BONES, measurePlantedFeet, type PlantedFoot } from './GeneratedBodyBindings'
import { MotionCurve } from './MotionCurve'
import { ProceduralTurnPlanner, type TurnContact } from './ProceduralTurnPlanner'
import { plantLeg } from './plantLeg'
import {
  closestSupportPoint,
  supportHull,
  supportMargin,
  supportsOverlap,
} from './TurnSupportGeometry'

const ease = (x: number) => x ** 3 * (10 + x * (-15 + 6 * x))
const unit = (x: number) => THREE.MathUtils.clamp(x, 0, 1)
const MAX_DANCE_SECONDS = 8
const MAX_RECOVERY_SECONDS = 3
const RECOVERY_RELEASE_SECONDS = 0.5

interface SourceStep {
  side: number
  start: number
  end: number
  accent: number
  rise: number
  score: number
  displacement: THREE.Vector3
}

/** Detect dance accents from relative ankle movement. The native contact
 * confidence is one input because the model can predict a contact with drift. */
function sourceSteps(chunk: MotionChunk): SourceStep[] {
  const track = chunk.flashMotion?.danceFeet
  if (!track) return []
  const steps: SourceStep[] = []
  for (const side of [0, 1]) {
    const height = track.map((feet) => feet[side][1])
    const floor = [...height].sort((a, b) => a - b)[Math.floor(height.length * 0.2)]
    const movement = (index: number, foot: number) => {
      const from = track[Math.max(0, index - 3)][foot]
      const to = track[Math.min(track.length - 1, index + 3)][foot]
      return Math.hypot(to[0] - from[0], to[2] - from[2])
    }
    const score = height.map((value, index) => {
      const contact = chunk.footContacts[index]
      const planted =
        side === 0
          ? Math.max(contact.leftHeel, contact.leftToe)
          : Math.max(contact.rightHeel, contact.rightToe)
      const travel = movement(index, side)
      return (
        Math.max(0, value - floor) * 1.4 +
        Math.max(0, value - track[index][1 - side][1]) * 0.8 +
        travel * (0.45 + 0.35 * (1 - planted)) +
        Math.max(0, travel - movement(index, 1 - side)) * 0.75
      )
    })
    for (let index = 4; index < track.length - 4; index++) {
      if (
        score[index] < 0.027 ||
        score[index] !== Math.max(...score.slice(Math.max(0, index - 6), index + 7))
      )
        continue
      const start = Math.max(0, index - 6)
      const end = Math.min(track.length - 1, index + 7)
      const rise = Math.max(0, height[index] - floor)
      const displacement = new THREE.Vector3()
        .fromArray(track[end][side])
        .sub(new THREE.Vector3().fromArray(track[start][side]))
      displacement.y = 0
      steps.push({ side, start, end, accent: index, rise, score: score[index], displacement })
    }
  }
  const distinct: SourceStep[] = []
  for (const step of steps.sort((a, b) => b.score - a.score))
    if (!distinct.some((seen) => Math.abs(seen.start - step.start) < 10)) distinct.push(step)
  return distinct.sort((a, b) => a.start - b.start)
}

interface DanceSegment {
  duration: number
  transfer: number
  swing: number | null
  start: readonly TurnContact[]
  target: THREE.Vector3
  x: MotionCurve
  y: MotionCurve
  z: MotionCurve
  lift: number
  accentTime?: number
}

interface DanceAccent {
  time: number
  frame: number
}

const accentChannels = BONES.filter(([, name]) =>
  /^(spine|chest|upperChest)$|(?:UpperArm|LowerArm|Hand)$/u.test(name),
).map(([channel]) => channel)

function upperBodyActivity(rotations: MotionChunk['rotations']): number[] {
  return rotations.map((_, frame) => {
    const from = rotations[Math.max(0, frame - 2)]
    const to = rotations[Math.min(rotations.length - 1, frame + 2)]
    return accentChannels.reduce((energy, channel) => {
      const [x, y, z, w] = from[channel]
      const [a, b, c, d] = to[channel]
      return energy + 2 * Math.acos(Math.min(1, Math.abs(x * a + y * b + z * c + w * d)))
    }, 0)
  })
}

/** A monotone clock for the original source. Shared knot derivatives keep
 * the arms moving through a step boundary that was retimed by the rig. */
function accentTimeline(accents: DanceAccent[]): MotionCurve[] {
  const rates = accents.slice(1).map(({ time, frame }, index) => {
    const previous = accents[index]
    return (frame - previous.frame) / (time - previous.time)
  })
  const velocity = (index: number) => Math.min(rates[index - 1] ?? 0, rates[index] ?? 0)
  return rates.map((_, index) => {
    const start = accents[index]
    const end = accents[index + 1]
    return new MotionCurve(
      start.time,
      end.time - start.time,
      start.frame,
      end.frame,
      velocity(index),
      0,
      velocity(index + 1),
    )
  })
}

/** Retargets the generated steps to an acquired stance. The animation clock,
 * rig, final body composition and Overlay projection stay with the body owner. */
export class DanceInPlaceMotion {
  readonly feet: Array<PlantedFoot & { support: boolean }>
  elapsed = 0
  phaseElapsed = 0
  phase: MotionPhaseId = 'prepare'
  outcome: MotionOutcome | null = null
  private readonly rig: ProceduralTurnPlanner
  private readonly hips: THREE.Object3D
  private readonly startRoot: THREE.Vector3
  private root: THREE.Vector3
  private previousRoot: THREE.Vector3
  private previousVelocity = new THREE.Vector3()
  private maxSpeed = 0
  private maxAcceleration = 0
  private maxSupportDrift = 0
  private readonly initial: TurnContact[]
  private readonly path: DanceSegment[] = []
  private readonly upperTimeline: MotionCurve[]
  private readonly lastSourceFrame: number
  private recoveryIndex: number
  private recoveryStartedAt = 0
  private index = 0
  private steps = 0
  private released = false
  private seconds = 1 / 60
  private stop: MotionOutcome | null = null
  private failed = false

  constructor(
    private readonly vrm: VRM,
    private readonly intent: BodyDanceIntent,
    source: MotionChunk,
    private readonly baseHeading: number,
  ) {
    const hips = vrm.humanoid.getNormalizedBoneNode('hips')
    if (!hips) throw new Error('MOTION_RIG_UNSUPPORTED')
    this.hips = hips
    const sign = vrm.meta.metaVersion === '0' ? -1 : 1
    this.feet = measurePlantedFeet(vrm, sign).map((foot) => ({ ...foot, support: true }))
    if (this.feet.length !== 2) throw new Error('MOTION_RIG_UNSUPPORTED')
    this.initial = this.feet.map(({ target, orientation }) => ({
      position: target.clone(),
      orientation: orientation.clone(),
    }))
    this.rig = new ProceduralTurnPlanner(vrm, intent.tempo)
    this.startRoot = hips.getWorldPosition(new THREE.Vector3())
    this.root = this.startRoot.clone()
    this.previousRoot = this.root.clone()
    let root = this.startRoot
    let contacts = this.initial
    let duration = 0
    let lastEnd = -1
    this.lastSourceFrame = source.rotations.length - 1
    const activity = upperBodyActivity(source.rotations)
    const accents: DanceAccent[] = [{ time: 0, frame: 0 }]
    let lastSourceAccent = 0
    for (const proposal of sourceSteps(source)) {
      if (proposal.start < lastEnd - 2) continue
      const segment = this.fitStep(contacts, root, proposal, sign)
      if (!segment || duration + segment.duration + 1.5 > MAX_DANCE_SECONDS) continue
      // Keep the generated coordination around each ankle accent. Find the
      // nearby upper-body accent and align it with the fitted swing apex.
      const first = Math.max(lastSourceAccent + 1, proposal.accent - 4)
      const last = Math.min(this.lastSourceFrame - 1, proposal.accent + 4)
      let frame = THREE.MathUtils.clamp(proposal.accent, first, last)
      const score = (index: number) =>
        activity[index] / (1 + 0.08 * Math.abs(index - proposal.accent))
      for (let candidate = first; candidate <= last; candidate++) {
        if (score(candidate) > score(frame)) frame = candidate
      }
      const accentTime = (segment.transfer + segment.duration) / 2
      segment.accentTime = accentTime
      accents.push({ time: duration + accentTime, frame })
      lastSourceAccent = frame
      this.path.push(segment)
      duration += segment.duration
      lastEnd = proposal.end
      contacts = this.sample(segment, segment.duration).contacts
      root = this.sample(segment, segment.duration).root
    }
    let recovery = this.planRecovery(contacts, root, MAX_DANCE_SECONDS - duration)
    while (!recovery && this.path.length > 2) {
      const last = this.path.pop()
      const previous = this.path.at(-1)
      if (!last || !previous) break
      accents.pop()
      duration -= last.duration
      const landing = this.sample(previous, previous.duration)
      recovery = this.planRecovery(landing.contacts, landing.root, MAX_DANCE_SECONDS - duration)
    }
    if (this.path.length < 2 || !recovery) throw new Error('MOTION_DANCE_SUPPORT_UNREACHED')
    this.recoveryIndex = this.path.length
    this.path.push(...recovery)
    accents.push({ time: duration + RECOVERY_RELEASE_SECONDS, frame: this.lastSourceFrame })
    this.upperTimeline = accentTimeline(accents)
  }

  get upperBodyProgress(): number {
    const curve = this.upperTimeline.find((part) => this.elapsed < part.start + part.duration)
    return curve ? unit(curve.sample(this.elapsed).position / this.lastSourceFrame) : 1
  }

  get upperBodyGain(): number {
    const gain = this.intent.style === 'smooth' ? 0.45 : 0.7
    const entry = ease(unit(this.elapsed / this.path[0].transfer))
    const { accentTime, duration } = this.path[this.index]
    if (accentTime === undefined) return 1 + gain
    const rise = ease(unit(this.phaseElapsed / accentTime))
    const fall = ease(unit((duration - this.phaseElapsed) / (duration - accentTime)))
    return 1 + entry * gain * (1 + 0.5 * rise * fall)
  }

  get preparationProgress(): number {
    return unit(this.phaseElapsed / this.path[0].transfer)
  }

  get recoveryProgress(): number {
    return this.phase === 'recover'
      ? unit((this.elapsed - this.recoveryStartedAt) / RECOVERY_RELEASE_SECONDS)
      : 0
  }

  private fitStep(contacts: TurnContact[], root: THREE.Vector3, source: SourceStep, sign: number) {
    const leg = this.rig.legLength
    const foot = contacts[source.side]
    const neutral = this.initial[source.side].position
    const delta = source.displacement.clone().multiplyScalar((sign * leg) / 0.87)
    delta.clampLength(0, Math.min(0.16, leg * 0.18)).applyQuaternion(this.rig.reference)
    delta.y = 0
    const swingTime = THREE.MathUtils.clamp(
      (source.end - source.start) / 30 / this.intent.tempo,
      0.28,
      0.56,
    )
    const lift = THREE.MathUtils.clamp((source.rise * leg) / 0.65, leg * 0.04, leg * 0.1)
    for (const scale of [1, 0.6, 0.25, 0]) {
      const offset = foot.position.clone().addScaledVector(delta, scale).sub(neutral)
      offset.clampLength(0, Math.min(0.2, leg * 0.21))
      const target = neutral.clone().add(offset)
      const segment = this.stepToward(contacts, root, source.side, target, swingTime, lift)
      if (segment) return segment
    }
    return null
  }

  private stepToward(
    contacts: TurnContact[],
    root: THREE.Vector3,
    side: number,
    target: THREE.Vector3,
    swingTime: number,
    lift: number,
  ): DanceSegment | null {
    const leg = this.rig.legLength
    const stance = 1 - side
    const support = closestSupportPoint(
      new THREE.Vector2(root.x, root.z),
      this.rig.footprint(stance, contacts[stance]),
      leg * 0.014,
    )
    const end = new THREE.Vector3(
      support.x - this.rig.comOffset.x,
      Math.min(root.y, this.startRoot.y - Math.min(0.072, leg * 0.048)),
      support.y - this.rig.comOffset.z,
    )
    for (const transfer of [0.36, 0.5, 0.65, 0.8, 0.98, 1.17]) {
      const segment = this.segment(contacts, root, end, transfer, swingTime, side, target, lift)
      if (this.feasible(segment)) return segment
    }
    return null
  }

  /** Return to the measured entry stance, releasing one foot at a time. */
  private planRecovery(contacts: TurnContact[], root: THREE.Vector3, budget: number) {
    let best: DanceSegment[] | null = null
    let fastest = Math.min(MAX_RECOVERY_SECONDS, budget)
    for (const order of [
      [0, 1],
      [1, 0],
    ]) {
      let current = { contacts, root }
      const steps: DanceSegment[] = []
      for (const side of order) {
        const target = this.initial[side].position
        const distance = current.contacts[side].position.distanceTo(target)
        if (distance <= 1e-6) continue
        const seconds = THREE.MathUtils.clamp(distance / 0.35, 0.28, 0.55)
        const step = this.stepToward(
          current.contacts,
          current.root,
          side,
          target,
          seconds,
          this.rig.legLength * 0.05,
        )
        if (!step) break
        steps.push(step)
        current = this.sample(step, step.duration)
      }
      if (
        current.contacts.some(
          (foot, side) => foot.position.distanceTo(this.initial[side].position) > 1e-6,
        )
      )
        continue
      const settle = this.settle(current.contacts, current.root)
      if (!settle) continue
      const duration = steps.reduce((total, step) => total + step.duration, settle.duration)
      if (duration > fastest) continue
      fastest = duration
      best = [...steps, settle]
    }
    return best
  }

  private settle(contacts: TurnContact[], root: THREE.Vector3): DanceSegment | null {
    const hull = supportHull(contacts.flatMap((foot, index) => this.rig.footprint(index, foot)))
    const centre = closestSupportPoint(
      new THREE.Vector2(
        this.startRoot.x + this.rig.comOffset.x,
        this.startRoot.z + this.rig.comOffset.z,
      ),
      hull,
      this.rig.legLength * 0.012,
    )
    const settled = new THREE.Vector3(
      centre.x - this.rig.comOffset.x,
      this.startRoot.y,
      centre.y - this.rig.comOffset.z,
    )
    for (const seconds of [0.5, 0.7, 0.9, 1.15, 1.45]) {
      const segment = this.segment(contacts, root, settled, seconds, 0, null, settled, 0)
      if (this.feasible(segment)) return segment
      settled.y -= this.rig.legLength * 0.005
    }
    return null
  }

  private segment(
    start: TurnContact[],
    from: THREE.Vector3,
    to: THREE.Vector3,
    transfer: number,
    swingTime: number,
    swing: number | null,
    target: THREE.Vector3,
    lift: number,
  ): DanceSegment {
    return {
      duration: transfer + swingTime,
      transfer,
      swing,
      start,
      target,
      lift,
      x: new MotionCurve(0, transfer, from.x, to.x),
      y: new MotionCurve(0, transfer, from.y, to.y),
      z: new MotionCurve(0, transfer, from.z, to.z),
    }
  }

  private sample(segment: DanceSegment, time: number) {
    const x = segment.x.sample(time),
      y = segment.y.sample(time),
      z = segment.z.sample(time)
    const root = new THREE.Vector3(x.position, y.position, z.position)
    const contacts = segment.start.map((foot) => ({
      position: foot.position.clone(),
      orientation: foot.orientation,
    }))
    const flying = segment.swing !== null && time > segment.transfer && time < segment.duration
    if (segment.swing !== null && time > segment.transfer) {
      const u = unit((time - segment.transfer) / (segment.duration - segment.transfer))
      contacts[segment.swing].position.lerp(segment.target, ease(u))
      contacts[segment.swing].position.y += segment.lift * (4 * u * (1 - u)) ** 3
    }
    const height = Math.max(0.1, root.y + this.rig.comOffset.y - this.rig.floor)
    const zmp = new THREE.Vector2(
      root.x + this.rig.comOffset.x - (height * x.acceleration) / 9.81,
      root.z + this.rig.comOffset.z - (height * z.acceleration) / 9.81,
    )
    return { root, contacts, flying, zmp }
  }

  private feasible(segment: DanceSegment): boolean {
    for (let step = 0; step <= 36; step++) {
      const pose = this.sample(segment, (step / 36) * segment.duration)
      if (Math.hypot(pose.root.x - this.startRoot.x, pose.root.z - this.startRoot.z) > 0.24)
        return false
      const footprints = pose.contacts.map((foot, index) => this.rig.footprint(index, foot))
      if (supportsOverlap(footprints[0], footprints[1], this.rig.legLength * 0.01)) return false
      const support =
        pose.flying && segment.swing !== null
          ? footprints[1 - segment.swing]
          : supportHull(footprints.flat())
      if (supportMargin(pose.zmp, support) < -0.0005) return false
      for (const [index, leg] of this.rig.legs.entries()) {
        const hip = leg.hipOffset.clone().applyQuaternion(this.rig.reference).add(pose.root)
        const length = leg.upperLength + leg.lowerLength
        const distance = hip.distanceTo(pose.contacts[index].position)
        if (distance > length + 0.0007 || distance < length * 0.55) return false
      }
    }
    return true
  }

  requestStop(outcome: 'cancelled' | 'superseded' = 'cancelled'): void {
    this.stop ??= outcome
  }

  advance(delta: number): void {
    if (this.outcome) return
    this.seconds = Math.max(0, Math.min(0.1, delta))
    let remaining = this.seconds
    while (remaining > 1e-8 && !this.outcome) {
      const segment = this.path[this.index]
      const recovering = this.index >= this.recoveryIndex
      const interrupted = this.stop || this.failed
      const end =
        interrupted && !recovering && !this.released
          ? this.phaseElapsed < 1e-8
            ? 0
            : segment.transfer
          : segment.duration
      const dt = Math.min(remaining, 1 / 60, end - this.phaseElapsed)
      this.elapsed += dt
      this.phaseElapsed += dt
      remaining -= dt
      const pose = this.sample(segment, this.phaseElapsed)
      this.root.copy(pose.root)
      for (const [index, foot] of this.feet.entries()) {
        foot.target.copy(pose.contacts[index].position)
        foot.support = !pose.flying || index !== segment.swing
      }
      if (pose.flying && !this.released) {
        this.released = true
        if (!recovering) {
          this.steps++
          this.phase = 'stroke'
        }
      }
      this.restorePlannedRoot()
      if (!this.solveLegs()) this.failed = true
      if (this.phaseElapsed < end - 1e-8) continue
      if (segment.swing === null) {
        this.outcome = this.failed ? 'failed' : (this.stop ?? 'completed')
        break
      }
      this.phaseElapsed = 0
      this.released = false
      this.index++
      if (!recovering && (this.stop || this.failed)) {
        this.recoveryIndex = this.index
        const recovery = this.planRecovery(pose.contacts, pose.root, MAX_RECOVERY_SECONDS)
        if (recovery) this.path.splice(this.index, this.path.length - this.index, ...recovery)
        else {
          this.failed = true
          const settle = this.settle(pose.contacts, pose.root)
          if (settle) this.path.splice(this.index, this.path.length - this.index, settle)
          else this.outcome = 'failed'
        }
      }
      if (!this.outcome && this.index === this.recoveryIndex) {
        this.phase = 'recover'
        this.recoveryStartedAt = this.elapsed
      }
    }
  }

  restorePlannedRoot(): void {
    const root = this.root.clone()
    this.hips.parent?.worldToLocal(root)
    this.hips.position.copy(root)
    this.vrm.scene.updateMatrixWorld(true)
  }

  private solveLegs(): boolean {
    let valid = true
    for (const foot of this.feet) {
      plantLeg(foot.upper, foot.lower, foot.foot, foot.target, foot.orientation, foot.pole)
      const error = foot.foot.getWorldPosition(new THREE.Vector3()).distanceTo(foot.target)
      if (foot.support) this.maxSupportDrift = Math.max(this.maxSupportDrift, error)
      const upper = foot.upper
        .getWorldPosition(new THREE.Vector3())
        .sub(foot.lower.getWorldPosition(new THREE.Vector3()))
      const lower = foot.foot
        .getWorldPosition(new THREE.Vector3())
        .sub(foot.lower.getWorldPosition(new THREE.Vector3()))
      valid &&=
        error <= 0.003 &&
        Math.PI - upper.angleTo(lower) <= 2.45 &&
        foot.foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(foot.orientation) < 0.03
    }
    return valid
  }

  solveAndVerify(contactsClear: boolean): void {
    const root = this.hips.getWorldPosition(new THREE.Vector3())
    if (this.seconds > 1e-8) {
      const velocity = root.clone().sub(this.previousRoot).divideScalar(this.seconds)
      velocity.y = 0
      this.maxSpeed = Math.max(this.maxSpeed, velocity.length())
      this.maxAcceleration = Math.max(
        this.maxAcceleration,
        velocity.distanceTo(this.previousVelocity) / this.seconds,
      )
      this.previousVelocity.copy(velocity)
      this.previousRoot.copy(root)
    }
    if (!this.solveLegs() || !contactsClear) {
      this.failed = true
      if (this.outcome) this.outcome = 'failed'
    }
  }

  getStage() {
    return {
      position: this.vrm.scene.position.toArray(),
      orientation: this.vrm.scene.quaternion.toArray(),
      continuousHeading: this.baseHeading,
      generator: 'flashmotion' as const,
    }
  }

  getStatus() {
    return {
      generator: 'flashmotion' as const,
      danceStyle: this.intent.style,
      actionHeading: 0,
      support: this.feet.every((foot) => foot.support)
        ? ('double' as const)
        : this.feet[0].support
          ? ('left' as const)
          : ('right' as const),
      steps: this.steps,
      maxRootSpeedMps: this.maxSpeed,
      maxRootAccelerationMps2: this.maxAcceleration,
      maxSupportDriftM: this.maxSupportDrift,
      outcome: this.outcome,
    }
  }
}
