import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import { headMotionTuning } from './avatarTuning'

export type HeadMotionProfile = 'idle' | 'listening' | 'thinking' | 'speaking' | 'userFocus'
export type HeadAttentionImpulse = 'user-interruption'
export type HeadMotionGeneratorId =
  | 'idleDrift'
  | 'microTilt'
  | 'slowYaw'
  | 'speakingNod'
  | 'listeningTilt'
  | 'thinkingDrift'

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

  update(context: HeadMotionGeneratorContext): HeadMotionGeneratorContribution {
    const tuning = headMotionTuning.generators.speakingNod
    this.nextEventMs -= context.deltaMs
    const weight = headMotionTuning.profiles[context.profile].generatorWeights.speakingNod
    if (weight > 0 && this.nextEventMs <= 0 && this.elapsedMs <= 0) {
      this.amplitude = tuning.pitchAmplitude * (0.65 + context.random() * 0.35)
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

class HeadMotionResolver {
  private generators: HeadMotionGenerator[] = [
    new IdleDriftGenerator(),
    new MicroTiltGenerator(),
    new SlowYawGenerator(),
    new SpeakingNodGenerator(),
    new ListeningTiltGenerator(),
    new ThinkingDriftGenerator(),
  ]

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
  private randomState = headMotionTuning.randomSeed
  private elapsedMs = 0
  private currentPose: HeadMotionPose = zeroPose()
  private appliedHeadPose: HeadMotionPose = zeroPose()
  private appliedNeckPose: HeadMotionPose = zeroPose()
  private attentionImpulseMs = 0
  private attentionImpulseCooldownMs = 0
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
  }

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm
  }

  detach(): void {
    this.remove()
    this.vrm = null
    this.attentionImpulseMs = 0
    this.attentionImpulseCooldownMs = 0
  }

  setProfile(profile: HeadMotionProfile): void {
    this.profile = profile
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
    const resolved = this.resolver.resolve({
      delta,
      deltaMs: delta * 1000,
      profile: this.profile,
      elapsedMs: this.elapsedMs,
      random: () => this.nextRandom(),
    })
    const blend = 1 - Math.exp(-headMotionTuning.smoothing * delta)
    const targetPose = addPose(
      resolved.pose,
      scalePose(headMotionTuning.attentionImpulse.pose, this.attentionImpulseEnvelope()),
    )
    this.currentPose = smoothPose(this.currentPose, targetPose, delta, headMotionTuning.smoothing)
    this.currentPose = clampPose(this.currentPose)

    const neckPose = scalePose(this.currentPose, headMotionTuning.neckShare)
    const headPose = scalePose(this.currentPose, headMotionTuning.headShare)
    this.applyToBones(
      addPose(headPose, scalePose(this.appliedHeadPose, -1)),
      addPose(neckPose, scalePose(this.appliedNeckPose, -1)),
    )
    this.appliedHeadPose = headPose
    this.appliedNeckPose = neckPose

    this.debug = {
      profile: this.profile,
      activeGenerators: resolved.activeGenerators,
      yawOffset: this.currentPose.yaw,
      pitchOffset: this.currentPose.pitch,
      rollOffset: this.currentPose.roll,
      motionEnergy: poseEnergy(this.currentPose),
      currentBlend: blend,
      generatorWeights: resolved.generatorWeights,
      smoothing: headMotionTuning.smoothing,
      nextProceduralEventMs: resolved.nextEventMs,
      attentionImpulseActive: this.attentionImpulseMs > 0,
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
