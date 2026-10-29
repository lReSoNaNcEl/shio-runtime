import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'

import type { EmotionEmbodimentProfile } from '../../EmotionEmbodimentProfile'
import { headMotionTuning } from '../../tuning/motionTuning'

export type HeadMotionProfile = 'idle' | 'listening' | 'thinking' | 'speaking' | 'userFocus'
/** Directed-gaze head authority at and above which attention shifts run in full. */
const ATTENTION_FULL_AUTHORITY = 0.32
/** Per-second smoothing of the measured acting-hand side. */
const GESTURE_FOCUS_SMOOTHING = 4
export type HeadAttentionImpulse = 'user-interruption'
export type HeadMotionGeneratorId =
  | 'idleDrift'
  | 'microTilt'
  | 'slowYaw'
  | 'speakingNod'
  | 'listeningTilt'
  | 'thinkingDrift'
  | 'attentionShift'

export interface HeadMotionPose {
  yaw: number
  pitch: number
  roll: number
}

export interface HeadMotionDebugState {
  profile: HeadMotionProfile
  activeGenerators: HeadMotionGeneratorId[]
  yawOffset: number
  pitchOffset: number
  rollOffset: number
  motionEnergy: number
  currentBlend: number
  generatorWeights: Record<HeadMotionGeneratorId, number>
  smoothing: number
  nextProceduralEventMs: number
  attentionImpulseActive: boolean
  authorityWeight: number
}

interface HeadMotionGeneratorContribution {
  id: HeadMotionGeneratorId
  pose: HeadMotionPose
  weight: number
  nextEventMs: number
}

interface HeadMotionGeneratorContext {
  delta: number
  deltaMs: number
  profile: HeadMotionProfile
  elapsedMs: number
  speechEnergy: number
  /** Signed side of the visibly acting hand: +1 left, -1 right, 0 none/both. */
  gestureFocus?: number
  random: () => number
}

interface HeadMotionGenerator {
  readonly id: HeadMotionGeneratorId
  update(context: HeadMotionGeneratorContext): HeadMotionGeneratorContribution
}

class IdleDriftGenerator implements HeadMotionGenerator {
  readonly id = 'idleDrift' as const
  private current: HeadMotionPose = zeroPose()
  private target: HeadMotionPose = zeroPose()
  private nextEventMs = 0

  update(context: HeadMotionGeneratorContext): HeadMotionGeneratorContribution {
    const tuning = headMotionTuning.generators.idleDrift
    this.nextEventMs -= context.deltaMs
    if (this.nextEventMs <= 0) {
      this.target = {
        yaw: randomSigned(context.random, tuning.yawAmplitude),
        pitch: randomSigned(context.random, tuning.pitchAmplitude),
        roll: randomSigned(context.random, tuning.rollAmplitude),
      }
      this.nextEventMs = randomRange(context.random, tuning.intervalMs.min, tuning.intervalMs.max)
    }

    this.current = smoothPose(this.current, this.target, context.delta, tuning.smoothing)
    return contribution(
      this.id,
      this.current,
      headMotionTuning.profiles[context.profile].generatorWeights.idleDrift,
      this.nextEventMs,
    )
  }
}

class MicroTiltGenerator implements HeadMotionGenerator {
  readonly id = 'microTilt' as const
  private pose: HeadMotionPose = zeroPose()
  private impulse: HeadMotionPose = zeroPose()
  private nextEventMs = 0
  private elapsedMs = 0
  private durationMs = 1

  update(context: HeadMotionGeneratorContext): HeadMotionGeneratorContribution {
    const tuning = headMotionTuning.generators.microTilt
    this.nextEventMs -= context.deltaMs
    if (this.nextEventMs <= 0 && this.elapsedMs <= 0) {
      this.impulse = {
        yaw: randomSigned(context.random, tuning.yawAmplitude),
        pitch: randomSigned(context.random, tuning.pitchAmplitude),
        roll: randomSigned(context.random, tuning.rollAmplitude),
      }
      this.durationMs = randomRange(context.random, tuning.durationMs.min, tuning.durationMs.max)
      this.elapsedMs = this.durationMs
      this.nextEventMs = randomRange(context.random, tuning.intervalMs.min, tuning.intervalMs.max)
    }

    if (this.elapsedMs > 0) {
      this.elapsedMs = Math.max(0, this.elapsedMs - context.deltaMs)
      const progress = 1 - this.elapsedMs / Math.max(1, this.durationMs)
      const envelope = Math.sin(Math.PI * Math.max(0, Math.min(1, progress)))
      this.pose = scalePose(this.impulse, envelope)
    } else {
      this.pose = smoothPose(this.pose, zeroPose(), context.delta, tuning.releaseSmoothing)
    }

    return contribution(
      this.id,
      this.pose,
      headMotionTuning.profiles[context.profile].generatorWeights.microTilt,
      this.nextEventMs,
    )
  }
}

class SlowYawGenerator implements HeadMotionGenerator {
  readonly id = 'slowYaw' as const
  private current: HeadMotionPose = zeroPose()
  private target: HeadMotionPose = zeroPose()
  private nextEventMs = 0

  update(context: HeadMotionGeneratorContext): HeadMotionGeneratorContribution {
    const tuning = headMotionTuning.generators.slowYaw
    this.nextEventMs -= context.deltaMs
    if (this.nextEventMs <= 0) {
      this.target = { yaw: randomSigned(context.random, tuning.amplitude), pitch: 0, roll: 0 }
      this.nextEventMs = randomRange(context.random, tuning.intervalMs.min, tuning.intervalMs.max)
    }
    this.current = smoothPose(this.current, this.target, context.delta, tuning.smoothing)
    return contribution(
      this.id,
      this.current,
      headMotionTuning.profiles[context.profile].generatorWeights.slowYaw,
      this.nextEventMs,
    )
  }
}

class SpeakingNodGenerator implements HeadMotionGenerator {
  readonly id = 'speakingNod' as const
  private pose: HeadMotionPose = zeroPose()
  private nextEventMs = 0
  private elapsedMs = 0
  private durationMs = 1
  private amplitude = 0
  private armed = true

  update(context: HeadMotionGeneratorContext): HeadMotionGeneratorContribution {
    const tuning = headMotionTuning.generators.speakingNod
    this.nextEventMs -= context.deltaMs
    const weight = headMotionTuning.profiles[context.profile].generatorWeights.speakingNod
    if (context.speechEnergy < tuning.rearmEnergy || weight === 0) {
      this.armed = true
      this.elapsedMs = 0
    }
    if (
      weight > 0 &&
      this.armed &&
      context.speechEnergy >= tuning.triggerEnergy &&
      this.nextEventMs <= 0 &&
      this.elapsedMs <= 0
    ) {
      this.armed = false
      this.amplitude =
        tuning.pitchAmplitude *
        (0.65 + context.random() * 0.35) *
        Math.min(1, context.speechEnergy / tuning.fullEnergy)
      this.durationMs = randomRange(context.random, tuning.durationMs.min, tuning.durationMs.max)
      this.elapsedMs = this.durationMs
      this.nextEventMs = randomRange(context.random, tuning.intervalMs.min, tuning.intervalMs.max)
    }

    if (this.elapsedMs > 0) {
      this.elapsedMs = Math.max(0, this.elapsedMs - context.deltaMs)
      const progress = 1 - this.elapsedMs / Math.max(1, this.durationMs)
      const envelope = Math.sin(Math.PI * Math.max(0, Math.min(1, progress)))
      this.pose = { yaw: 0, pitch: -this.amplitude * envelope, roll: 0 }
    } else {
      this.pose = smoothPose(this.pose, zeroPose(), context.delta, tuning.releaseSmoothing)
    }

    return contribution(this.id, this.pose, weight, this.nextEventMs)
  }
}

class ListeningTiltGenerator implements HeadMotionGenerator {
  readonly id = 'listeningTilt' as const
  private pose: HeadMotionPose = zeroPose()

  update(context: HeadMotionGeneratorContext): HeadMotionGeneratorContribution {
    const tuning = headMotionTuning.generators.listeningTilt
    const target = context.profile === 'listening' ? tuning.pose : zeroPose()
    this.pose = smoothPose(this.pose, target, context.delta, tuning.smoothing)
    return contribution(
      this.id,
      this.pose,
      headMotionTuning.profiles[context.profile].generatorWeights.listeningTilt,
      tuning.nextEventMs,
    )
  }
}

class ThinkingDriftGenerator implements HeadMotionGenerator {
  readonly id = 'thinkingDrift' as const
  private pose: HeadMotionPose = zeroPose()

  update(context: HeadMotionGeneratorContext): HeadMotionGeneratorContribution {
    const tuning = headMotionTuning.generators.thinkingDrift
    const target = context.profile === 'thinking' ? tuning.pose : zeroPose()
    this.pose = smoothPose(this.pose, target, context.delta, tuning.smoothing)
    return contribution(
      this.id,
      this.pose,
      headMotionTuning.profiles[context.profile].generatorWeights.thinkingDrift,
      tuning.nextEventMs,
    )
  }
}

/**
 * Held re-orientations of attention: choose a direction, ease into it with a
 * critically damped spring, dwell, then turn again or return to centre. This is
 * the large conversational head/upper-body turn; the other generators remain
 * small texture on top of it.
 */
class AttentionShiftGenerator implements HeadMotionGenerator {
  readonly id = 'attentionShift' as const
  private pose: HeadMotionPose = zeroPose()
  private velocity: HeadMotionPose = zeroPose()
  private target: HeadMotionPose = zeroPose()
  private dwellMs = 0
  private lastSide = 0
  private followCooldownMs = 0

  update(context: HeadMotionGeneratorContext): HeadMotionGeneratorContribution {
    const tuning = headMotionTuning.generators.attentionShift
    const profile = tuning.profiles[context.profile]
    const focus = context.gestureFocus ?? 0
    const following = Math.abs(focus) >= tuning.gestureFocus.threshold
    this.dwellMs -= context.deltaMs
    this.followCooldownMs = Math.max(0, this.followCooldownMs - context.deltaMs)
    // A new gesture on the other side ends the current dwell early, once.
    if (
      following &&
      Math.sign(focus) !== Math.sign(this.target.yaw) &&
      this.followCooldownMs <= 0 &&
      this.dwellMs > tuning.gestureFocus.reactMs
    ) {
      this.dwellMs = tuning.gestureFocus.reactMs
      this.followCooldownMs = tuning.gestureFocus.cooldownMs
    }
    if (this.dwellMs <= 0) {
      const energy =
        context.profile === 'speaking'
          ? 0.6 + 0.4 * Math.min(1, context.speechEnergy / tuning.fullEnergy)
          : 1
      if (following && context.random() < tuning.gestureFocus.followChance) {
        // Turn toward the acting hand, slightly down toward the gesture space.
        const side = Math.sign(focus)
        this.lastSide = side
        const strength = Math.min(1, Math.abs(focus))
        this.target = {
          yaw:
            side *
            THREE.MathUtils.lerp(profile.yaw.min, profile.yaw.max, strength) *
            Math.max(energy, 0.8),
          pitch: tuning.gestureFocus.pitch + randomSigned(context.random, profile.pitch * 0.5),
          roll: side * randomRange(context.random, 0.4, 1) * profile.roll,
        }
      } else if (context.random() < profile.centerChance) {
        this.target = {
          yaw: randomSigned(context.random, 0.03),
          pitch: profile.pitchBias * 0.5 + randomSigned(context.random, profile.pitch * 0.3),
          roll: randomSigned(context.random, profile.roll * 0.3),
        }
        this.lastSide = 0
      } else {
        const side =
          this.lastSide !== 0 && context.random() < tuning.oppositeSideChance
            ? -this.lastSide
            : context.random() < 0.5
              ? -1
              : 1
        this.lastSide = side
        this.target = {
          yaw: side * randomRange(context.random, profile.yaw.min, profile.yaw.max) * energy,
          pitch: profile.pitchBias + randomSigned(context.random, profile.pitch),
          // The head usually tilts into the turn, sometimes away from it.
          roll:
            side *
            (context.random() < 0.7 ? 1 : -1) *
            randomRange(context.random, 0.3, 1) *
            profile.roll,
        }
      }
      this.dwellMs = randomRange(context.random, profile.dwellMs.min, profile.dwellMs.max)
    }

    const stiffness = tuning.stiffness
    const damping = 2 * Math.sqrt(stiffness)
    const step = Math.min(0.05, Math.max(0, context.delta))
    for (const axis of ['yaw', 'pitch', 'roll'] as const) {
      this.velocity[axis] +=
        (stiffness * (this.target[axis] - this.pose[axis]) - damping * this.velocity[axis]) * step
      this.pose[axis] += this.velocity[axis] * step
    }
    return contribution(
      this.id,
      { ...this.pose },
      headMotionTuning.profiles[context.profile].generatorWeights.attentionShift,
      this.dwellMs,
    )
  }
}

class HeadMotionResolver {
  private generators: HeadMotionGenerator[] = [
    new IdleDriftGenerator(),
    new MicroTiltGenerator(),
    new SlowYawGenerator(),
    new SpeakingNodGenerator(),
    new ListeningTiltGenerator(),
    new ThinkingDriftGenerator(),
  ]
  private attention = new AttentionShiftGenerator()

  /** Attention shifts are gaze-coordinated: the eyes may hold a directed target
   * while the head and upper body re-orient, so they use their own authority. */
  resolveAttention(context: HeadMotionGeneratorContext): HeadMotionGeneratorContribution {
    return this.attention.update(context)
  }

  resolve(context: HeadMotionGeneratorContext): {
    pose: HeadMotionPose
    activeGenerators: HeadMotionGeneratorId[]
    generatorWeights: Record<HeadMotionGeneratorId, number>
    nextEventMs: number
  } {
    const generatorWeights = zeroGeneratorWeights()
    const activeGenerators: HeadMotionGeneratorId[] = []
    let pose = zeroPose()
    let nextEventMs = Number.POSITIVE_INFINITY

    for (const generator of this.generators) {
      const result = generator.update(context)
      generatorWeights[result.id] = result.weight
      if (result.weight > 0.001 && poseEnergy(result.pose) > 0.0001)
        activeGenerators.push(result.id)
      pose = addPose(pose, scalePose(result.pose, result.weight))
      if (result.weight > 0.001) nextEventMs = Math.min(nextEventMs, result.nextEventMs)
    }

    return {
      pose: clampPose(pose),
      activeGenerators,
      generatorWeights,
      nextEventMs: Number.isFinite(nextEventMs) ? Math.max(0, nextEventMs) : 0,
    }
  }
}

export class HeadMotionRuntime {
  private vrm: VRM | null = null
  private resolver = new HeadMotionResolver()
  private profile: HeadMotionProfile = 'idle'
  private randomState: number = headMotionTuning.randomSeed
  private attentionRandomState: number = headMotionTuning.randomSeed ^ 0x5bd1e995
  private presentationOnly = false
  private torsoPose: HeadMotionPose = zeroPose()
  private gestureFocus = 0
  private elapsedMs = 0
  private currentPose: HeadMotionPose = zeroPose()
  private appliedHeadPose: HeadMotionPose = zeroPose()
  private appliedNeckPose: HeadMotionPose = zeroPose()
  private attentionImpulseMs = 0
  private attentionImpulseCooldownMs = 0
  private authorityWeight = 1
  private speechEnergy = 0
  private emotionHeadProfile: EmotionEmbodimentProfile['head'] = {
    energyScale: 1,
    nodBias: 1,
    tiltBias: 1,
  }
  private debug: HeadMotionDebugState = {
    profile: 'idle',
    activeGenerators: [],
    yawOffset: 0,
    pitchOffset: 0,
    rollOffset: 0,
    motionEnergy: 0,
    currentBlend: 0,
    generatorWeights: zeroGeneratorWeights(),
    smoothing: headMotionTuning.smoothing,
    nextProceduralEventMs: 0,
    attentionImpulseActive: false,
    authorityWeight: 1,
  }

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm
  }

  detach(): void {
    this.remove()
    this.vrm = null
    this.speechEnergy = 0
    this.resolver = new HeadMotionResolver()
    this.currentPose = zeroPose()
    this.torsoPose = zeroPose()
    this.gestureFocus = 0
    this.elapsedMs = 0
    this.debug = {
      ...this.debug,
      activeGenerators: [],
      yawOffset: 0,
      pitchOffset: 0,
      rollOffset: 0,
      motionEnergy: 0,
      attentionImpulseActive: false,
    }
    this.attentionImpulseMs = 0
    this.attentionImpulseCooldownMs = 0
  }

  setProfile(profile: HeadMotionProfile): void {
    this.profile = profile
  }

  /** Overlay presents the primary's composed head; it never writes its own. */
  setPresentationOnly(value: boolean): void {
    if (value === this.presentationOnly) return
    this.remove()
    this.presentationOnly = value
  }

  /** Share of the current orientation carried by the upper body (spine/chest). */
  getTorsoPose(): HeadMotionPose {
    return this.presentationOnly ? zeroPose() : { ...this.torsoPose }
  }

  setAuthorityWeight(weight: number): void {
    this.authorityWeight = THREE.MathUtils.clamp(weight, 0, 1)
  }

  setSpeechEnergy(energy: number): void {
    this.speechEnergy = Number.isFinite(energy) ? THREE.MathUtils.clamp(energy, 0, 1) : 0
  }

  applyEmotionProfile(profile: EmotionEmbodimentProfile): void {
    this.emotionHeadProfile = { ...profile.head }
  }

  triggerAttentionImpulse(impulse: HeadAttentionImpulse): boolean {
    if (impulse !== 'user-interruption' || this.attentionImpulseCooldownMs > 0) return false
    const tuning = headMotionTuning.attentionImpulse
    this.attentionImpulseMs = tuning.attackMs + tuning.holdMs + tuning.releaseMs
    this.attentionImpulseCooldownMs = tuning.cooldownMs
    this.debug = { ...this.debug, attentionImpulseActive: true }
    return true
  }

  remove(): void {
    this.applyToBones(scalePose(this.appliedHeadPose, -1), scalePose(this.appliedNeckPose, -1))
    this.appliedHeadPose = zeroPose()
    this.appliedNeckPose = zeroPose()
  }

  update(delta: number): void {
    this.elapsedMs += delta * 1000
    this.attentionImpulseMs = Math.max(0, this.attentionImpulseMs - delta * 1000)
    this.attentionImpulseCooldownMs = Math.max(0, this.attentionImpulseCooldownMs - delta * 1000)
    if (!this.vrm?.humanoid) {
      this.debug = {
        ...this.debug,
        attentionImpulseActive: this.attentionImpulseMs > 0,
      }
      return
    }
    const context = {
      delta,
      deltaMs: delta * 1000,
      profile: this.profile,
      elapsedMs: this.elapsedMs,
      speechEnergy: this.attentionImpulseMs > 0 ? 0 : this.speechEnergy,
      random: () => this.nextRandom(),
    }
    const resolved = this.resolver.resolve(context)
    if (!this.presentationOnly) {
      const focus = this.measureGestureFocus()
      this.gestureFocus +=
        (focus - this.gestureFocus) * (1 - Math.exp(-GESTURE_FOCUS_SMOOTHING * delta))
    }
    const attention = this.resolver.resolveAttention({
      ...context,
      gestureFocus: this.gestureFocus,
      random: () => this.nextAttentionRandom(),
    })
    const blend = 1 - Math.exp(-headMotionTuning.smoothing * delta)
    const emotionPose = {
      yaw: resolved.pose.yaw * this.emotionHeadProfile.energyScale,
      pitch:
        resolved.pose.pitch * this.emotionHeadProfile.energyScale * this.emotionHeadProfile.nodBias,
      roll:
        resolved.pose.roll * this.emotionHeadProfile.energyScale * this.emotionHeadProfile.tiltBias,
    }
    // Directed gaze (eyes on the user) keeps full attention shifts; screen focus
    // and other low-authority states scale them down proportionally.
    const attentionAuthority = THREE.MathUtils.clamp(
      this.authorityWeight / ATTENTION_FULL_AUTHORITY,
      0,
      1,
    )
    const targetPose = addPose(
      scalePose(
        addPose(
          emotionPose,
          scalePose(headMotionTuning.attentionImpulse.pose, this.attentionImpulseEnvelope()),
        ),
        this.authorityWeight,
      ),
      scalePose(
        attention.pose,
        attention.weight * attentionAuthority * this.emotionHeadProfile.energyScale,
      ),
    )
    this.currentPose = smoothPose(this.currentPose, targetPose, delta, headMotionTuning.smoothing)
    this.currentPose = clampPose(this.currentPose)

    const share = headMotionTuning.torsoShare
    this.torsoPose = {
      yaw: this.currentPose.yaw * share.yaw,
      pitch: this.currentPose.pitch * share.pitch,
      roll: this.currentPose.roll * share.roll,
    }
    const headTotal = addPose(this.currentPose, scalePose(this.torsoPose, -1))
    const neckPose = scalePose(headTotal, headMotionTuning.neckShare)
    const headPose = scalePose(headTotal, headMotionTuning.headShare)
    if (!this.presentationOnly) {
      this.applyToBones(
        addPose(headPose, scalePose(this.appliedHeadPose, -1)),
        addPose(neckPose, scalePose(this.appliedNeckPose, -1)),
      )
      this.appliedHeadPose = headPose
      this.appliedNeckPose = neckPose
    }

    const activeGenerators = [...resolved.activeGenerators]
    if (attention.weight > 0.001 && poseEnergy(attention.pose) > 0.0001)
      activeGenerators.push('attentionShift')
    this.debug = {
      profile: this.profile,
      activeGenerators,
      yawOffset: this.currentPose.yaw,
      pitchOffset: this.currentPose.pitch,
      rollOffset: this.currentPose.roll,
      motionEnergy: poseEnergy(this.currentPose),
      currentBlend: blend,
      generatorWeights: { ...resolved.generatorWeights, attentionShift: attention.weight },
      smoothing: headMotionTuning.smoothing,
      nextProceduralEventMs: Math.min(resolved.nextEventMs, Math.max(0, attention.nextEventMs)),
      attentionImpulseActive: this.attentionImpulseMs > 0,
      authorityWeight: this.authorityWeight,
    }
  }

  getDebugState(): HeadMotionDebugState {
    return {
      ...this.debug,
      generatorWeights: { ...this.debug.generatorWeights },
      activeGenerators: [...this.debug.activeGenerators],
    }
  }

  private applyToBones(headPose: HeadMotionPose, neckPose: HeadMotionPose): void {
    const head = this.vrm?.humanoid?.getNormalizedBoneNode('head')
    const neck = this.vrm?.humanoid?.getNormalizedBoneNode('neck')
    if (head) {
      head.rotation.y += headPose.yaw
      head.rotation.x += headPose.pitch
      head.rotation.z += headPose.roll
    }
    if (neck) {
      neck.rotation.y += neckPose.yaw
      neck.rotation.x += neckPose.pitch
      neck.rotation.z += neckPose.roll
    }
  }

  private nextRandom(): number {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0
    return this.randomState / 4294967296
  }

  /**
   * Which hand is visibly acting, from the composed pose this frame: +1 left,
   * -1 right, near 0 when neither or both are raised. Read-only bone queries;
   * the shoulder line defines the character side regardless of model facing.
   */
  private measureGestureFocus(): number {
    const humanoid = this.vrm?.humanoid
    if (!humanoid) return 0
    const at = (name: VRMHumanBoneName): THREE.Vector3 | null =>
      humanoid.getNormalizedBoneNode(name)?.getWorldPosition(new THREE.Vector3()) ?? null
    const hips = at('hips')
    const leftShoulder = at('leftUpperArm')
    const rightShoulder = at('rightUpperArm')
    const leftHand = at('leftHand')
    const rightHand = at('rightHand')
    if (!hips || !leftShoulder || !rightShoulder || !leftHand || !rightHand) return 0
    const lateral = leftShoulder.clone().sub(rightShoulder)
    const span = lateral.length()
    if (span < 1e-4) return 0
    lateral.divideScalar(span)
    const up = new THREE.Vector3(0, 1, 0)
    const forward = lateral.clone().cross(up).normalize()
    const activity = (hand: THREE.Vector3): number => {
      const offset = hand.clone().sub(hips)
      return (
        Math.max(0, offset.dot(up) / span - 0.15) + Math.max(0, offset.dot(forward) / span - 0.1)
      )
    }
    const left = activity(leftHand)
    const right = activity(rightHand)
    return THREE.MathUtils.clamp((left - right) / Math.max(left + right, 0.5), -1, 1)
  }

  private nextAttentionRandom(): number {
    this.attentionRandomState = (1664525 * this.attentionRandomState + 1013904223) >>> 0
    return this.attentionRandomState / 4294967296
  }

  private attentionImpulseEnvelope(): number {
    if (this.attentionImpulseMs <= 0) return 0
    const { attackMs, holdMs, releaseMs } = headMotionTuning.attentionImpulse
    const durationMs = attackMs + holdMs + releaseMs
    const elapsed = durationMs - this.attentionImpulseMs
    if (elapsed < attackMs) return elapsed / Math.max(1, attackMs)
    if (elapsed < attackMs + holdMs) return 1
    return Math.max(0, this.attentionImpulseMs / Math.max(1, releaseMs))
  }
}

function contribution(
  id: HeadMotionGeneratorId,
  pose: HeadMotionPose,
  weight: number,
  nextEventMs: number,
): HeadMotionGeneratorContribution {
  return { id, pose, weight, nextEventMs }
}

function zeroPose(): HeadMotionPose {
  return { yaw: 0, pitch: 0, roll: 0 }
}

function zeroGeneratorWeights(): Record<HeadMotionGeneratorId, number> {
  return {
    idleDrift: 0,
    microTilt: 0,
    slowYaw: 0,
    speakingNod: 0,
    listeningTilt: 0,
    thinkingDrift: 0,
    attentionShift: 0,
  }
}

function addPose(a: HeadMotionPose, b: HeadMotionPose): HeadMotionPose {
  return {
    yaw: a.yaw + b.yaw,
    pitch: a.pitch + b.pitch,
    roll: a.roll + b.roll,
  }
}

function scalePose(pose: HeadMotionPose, scale: number): HeadMotionPose {
  return {
    yaw: pose.yaw * scale,
    pitch: pose.pitch * scale,
    roll: pose.roll * scale,
  }
}

function smoothPose(
  current: HeadMotionPose,
  target: HeadMotionPose,
  delta: number,
  smoothing: number,
): HeadMotionPose {
  const blend = 1 - Math.exp(-smoothing * delta)
  return {
    yaw: THREE.MathUtils.lerp(current.yaw, target.yaw, blend),
    pitch: THREE.MathUtils.lerp(current.pitch, target.pitch, blend),
    roll: THREE.MathUtils.lerp(current.roll, target.roll, blend),
  }
}

function clampPose(pose: HeadMotionPose): HeadMotionPose {
  return {
    yaw: THREE.MathUtils.clamp(pose.yaw, -headMotionTuning.yawLimit, headMotionTuning.yawLimit),
    pitch: THREE.MathUtils.clamp(
      pose.pitch,
      -headMotionTuning.pitchLimit,
      headMotionTuning.pitchLimit,
    ),
    roll: THREE.MathUtils.clamp(pose.roll, -headMotionTuning.rollLimit, headMotionTuning.rollLimit),
  }
}

function poseEnergy(pose: HeadMotionPose): number {
  return Math.abs(pose.yaw) + Math.abs(pose.pitch) + Math.abs(pose.roll)
}

function randomRange(random: () => number, min: number, max: number): number {
  return min + random() * Math.max(0, max - min)
}

function randomSigned(random: () => number, amplitude: number): number {
  return (random() * 2 - 1) * amplitude
}
