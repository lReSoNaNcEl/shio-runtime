import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import { avatarLookAtTuning } from './avatarTuning'

export type LookAtMode = 'idle' | 'speaking' | 'listening' | 'thinking' | 'userFocus'
export type LookAtTargetKind =
  | 'none'
  | 'camera'
  | 'idleOffset'
  | 'thinkingOffset'
  | 'conversationFocus'

export interface LookAtDebugState {
  mode: LookAtMode
  target: LookAtTargetKind
  eyeYaw: number
  eyePitch: number
  nextSaccadeMs: number
  thinkingTimerMs: number
  returnProgress: number
  focusHoldMs: number
  overshootMs: number
  microSaccade: { yaw: number; pitch: number }
  headLagMs: number
}

interface LookAtModeTuning {
  saccadeIntervalMs: { min: number; max: number }
  saccadeAmplitude: { yaw: number; pitch: number }
  focusHoldMs: { min: number; max: number }
  eyeContactBias: number
  glanceAwayChance: number
  glanceAwayDurationMs: number
}

export class LookTargetResolver {
  private nextSaccadeMs = 0
  private saccadeDurationMs = 0
  private saccadeElapsedMs = 0
  private saccadeYaw = 0
  private saccadePitch = 0
  private glanceAwayMs = 0
  private focusHoldMs = 0
  private overshootElapsedMs = 0
  private overshootYaw = 0
  private overshootPitch = 0
  private thinkingTimerMs = 0
  private lastMode: LookAtMode = 'idle'

  resolve(input: {
    deltaMs: number
    mode: LookAtMode
    modeTuning: LookAtModeTuning
    baseTarget: THREE.Object3D | null
    target: THREE.Object3D
  }): {
    targetKind: LookAtTargetKind
    eyeYaw: number
    eyePitch: number
    returnProgress: number
    thinkingTimerMs: number
    nextSaccadeMs: number
  } {
    const { deltaMs, mode, modeTuning, baseTarget, target } = input
    if (!baseTarget) {
      this.resetMode(mode)
      return this.applyTarget(target, null, 'none', 0, 0, 1)
    }

    if (mode !== this.lastMode) this.resetMode(mode)
    this.lastMode = mode

    this.updateSaccade(deltaMs, modeTuning)
    this.updateGlance(deltaMs, mode, modeTuning)
    this.updateOvershoot(deltaMs)
    this.updateThinking(deltaMs, mode)

    let targetKind: LookAtTargetKind = mode === 'speaking' ? 'conversationFocus' : 'camera'
    let yaw = this.saccadeYaw
    let pitch = this.saccadePitch
    let returnProgress = 1

    if (mode === 'thinking') {
      const duration = avatarLookAtTuning.thinkingLookAwayDurationMs
      const hold = Math.min(1, this.thinkingTimerMs / Math.max(1, duration))
      const returnStart = avatarLookAtTuning.thinkingReturnStart
      const returning =
        hold > returnStart ? (hold - returnStart) / Math.max(0.001, 1 - returnStart) : 0
      const strength = 1 - this.easeInOut(returning)
      yaw += avatarLookAtTuning.targets.thinkingOffset.yaw * strength
      pitch += avatarLookAtTuning.targets.thinkingOffset.pitch * strength
      targetKind = 'thinkingOffset'
      returnProgress = returning
    } else if (this.glanceAwayMs > 0) {
      const progress = 1 - this.glanceAwayMs / Math.max(1, modeTuning.glanceAwayDurationMs)
      const strength = Math.sin(Math.PI * Math.max(0, Math.min(1, progress)))
      yaw += avatarLookAtTuning.targets.idleOffset.yaw * strength
      pitch += avatarLookAtTuning.targets.idleOffset.pitch * strength
      targetKind = 'idleOffset'
      returnProgress = progress > 0.5 ? (progress - 0.5) * 2 : 0
    }

    const eyeContact = modeTuning.eyeContactBias
    yaw *= 1 - eyeContact * 0.18
    pitch *= 1 - eyeContact * 0.18
    const overshoot = this.getOvershootEnvelope()
    yaw += this.overshootYaw * overshoot
    pitch += this.overshootPitch * overshoot

    return this.applyTarget(target, baseTarget, targetKind, yaw, pitch, returnProgress)
  }

  getThinkingTimerMs(): number {
    return this.thinkingTimerMs
  }

  getNextSaccadeMs(): number {
    return this.nextSaccadeMs
  }

  getFocusHoldMs(): number {
    return this.focusHoldMs
  }

  getOvershootMs(): number {
    return this.overshootElapsedMs
  }

  getMicroSaccade(): { yaw: number; pitch: number } {
    return { yaw: this.saccadeYaw, pitch: this.saccadePitch }
  }

  private applyTarget(
    target: THREE.Object3D,
    baseTarget: THREE.Object3D | null,
    targetKind: LookAtTargetKind,
    yaw: number,
    pitch: number,
    returnProgress: number,
  ): {
    targetKind: LookAtTargetKind
    eyeYaw: number
    eyePitch: number
    returnProgress: number
    thinkingTimerMs: number
    nextSaccadeMs: number
  } {
    if (baseTarget) {
      const base = new THREE.Vector3()
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(baseTarget.quaternion)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(baseTarget.quaternion)
      baseTarget.getWorldPosition(base)
      target.position.copy(base).addScaledVector(right, yaw).addScaledVector(up, pitch)
      target.updateMatrixWorld(true)
    }

    return {
      targetKind,
      eyeYaw: yaw,
      eyePitch: pitch,
      returnProgress,
      thinkingTimerMs: this.thinkingTimerMs,
      nextSaccadeMs: this.nextSaccadeMs,
    }
  }

  private resetMode(mode: LookAtMode): void {
    this.lastMode = mode
    this.glanceAwayMs = 0
    this.thinkingTimerMs = mode === 'thinking' ? 1 : 0
    this.nextSaccadeMs = 120 + Math.random() * 220
    this.saccadeElapsedMs = 0
    this.saccadeDurationMs = 0
    this.saccadeYaw = 0
    this.saccadePitch = 0
    this.focusHoldMs = 0
    this.overshootElapsedMs = 0
    this.overshootYaw = 0
    this.overshootPitch = 0
  }

  private updateSaccade(deltaMs: number, modeTuning: LookAtModeTuning): void {
    this.nextSaccadeMs -= deltaMs
    if (this.saccadeDurationMs > 0) {
      this.saccadeElapsedMs += deltaMs
      const progress = Math.min(1, this.saccadeElapsedMs / this.saccadeDurationMs)
      const envelope = Math.sin(Math.PI * progress)
      this.saccadeYaw *= envelope
      this.saccadePitch *= envelope
      if (progress >= 1) {
        this.saccadeDurationMs = 0
        this.saccadeYaw = 0
        this.saccadePitch = 0
      }
      return
    }

    if (this.nextSaccadeMs > 0) return
    this.saccadeDurationMs = avatarLookAtTuning.saccadeDurationMs
    this.saccadeElapsedMs = 0
    this.saccadeYaw = this.randomSigned(modeTuning.saccadeAmplitude.yaw)
    this.saccadePitch = this.randomSigned(modeTuning.saccadeAmplitude.pitch)
    this.nextSaccadeMs = this.randomRange(
      modeTuning.saccadeIntervalMs.min,
      modeTuning.saccadeIntervalMs.max,
    )
  }

  private updateGlance(deltaMs: number, mode: LookAtMode, modeTuning: LookAtModeTuning): void {
    this.glanceAwayMs = Math.max(0, this.glanceAwayMs - deltaMs)
    this.focusHoldMs = Math.max(0, this.focusHoldMs - deltaMs)
    if (this.glanceAwayMs > 0 || mode === 'thinking') return
    if (this.focusHoldMs > 0) return
    const chance = modeTuning.glanceAwayChance * (deltaMs / 1000)
    if (Math.random() < chance) {
      this.glanceAwayMs = modeTuning.glanceAwayDurationMs
      this.focusHoldMs = this.randomRange(modeTuning.focusHoldMs.min, modeTuning.focusHoldMs.max)
      this.startOvershoot(
        avatarLookAtTuning.targets.idleOffset.yaw,
        avatarLookAtTuning.targets.idleOffset.pitch,
      )
    }
  }

  private startOvershoot(yaw: number, pitch: number): void {
    this.overshootElapsedMs = avatarLookAtTuning.overshootDurationMs
    this.overshootYaw = yaw * avatarLookAtTuning.overshootStrength
    this.overshootPitch = pitch * avatarLookAtTuning.overshootStrength
  }

  private updateOvershoot(deltaMs: number): void {
    this.overshootElapsedMs = Math.max(0, this.overshootElapsedMs - deltaMs)
    if (this.overshootElapsedMs === 0) {
      this.overshootYaw = 0
      this.overshootPitch = 0
    }
  }

  private getOvershootEnvelope(): number {
    if (this.overshootElapsedMs <= 0) return 0
    const progress =
      1 - this.overshootElapsedMs / Math.max(1, avatarLookAtTuning.overshootDurationMs)
    return Math.sin(Math.PI * Math.max(0, Math.min(1, progress)))
  }

  private updateThinking(deltaMs: number, mode: LookAtMode): void {
    if (mode !== 'thinking') {
      this.thinkingTimerMs = 0
      return
    }
    this.thinkingTimerMs += deltaMs
  }

  private randomRange(min: number, max: number): number {
    return min + Math.random() * Math.max(0, max - min)
  }

  private randomSigned(value: number): number {
    return (Math.random() * 2 - 1) * value
  }

  private easeInOut(value: number): number {
    const t = Math.max(0, Math.min(1, value))
    return t * t * (3 - 2 * t)
  }
}

export class LookAtRuntime {
  private vrm: VRM | null = null
  private target = new THREE.Object3D()
  private resolvedTarget = new THREE.Object3D()
  private baseTarget: THREE.Object3D | null = null
  private resolver = new LookTargetResolver()
  private mode: LookAtMode = 'idle'
  private targetKind: LookAtTargetKind = 'none'
  private eyeYaw = 0
  private eyePitch = 0
  private returnProgress = 1
  private targetInitialized = false
  private headLagMs = 0

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm
    this.applyVrmLookAtTarget()
  }

  detach(): void {
    this.clearVrmLookAtTarget()
    this.vrm = null
    this.targetInitialized = false
    this.headLagMs = 0
  }

  setBaseTarget(target: THREE.Object3D | null): boolean {
    this.baseTarget = target
    this.targetInitialized = false
    return this.applyVrmLookAtTarget()
  }

  setMode(mode: LookAtMode): void {
    this.mode = mode
  }

  remove(): void {}

  update(delta: number): void {
    if (!this.vrm) return

    const tuning = avatarLookAtTuning.modes[this.mode]
    const resolved = this.resolver.resolve({
      deltaMs: delta * 1000,
      mode: this.mode,
      modeTuning: tuning,
      baseTarget: this.baseTarget,
      target: this.resolvedTarget,
    })
    this.applyHeadLag(delta)
    this.targetKind = resolved.targetKind
    this.eyeYaw = resolved.eyeYaw
    this.eyePitch = resolved.eyePitch
    this.returnProgress = resolved.returnProgress
  }

  getDebugState(): LookAtDebugState {
    return {
      mode: this.mode,
      target: this.targetKind,
      eyeYaw: this.eyeYaw,
      eyePitch: this.eyePitch,
      nextSaccadeMs: this.resolver.getNextSaccadeMs(),
      thinkingTimerMs: this.resolver.getThinkingTimerMs(),
      returnProgress: this.returnProgress,
      focusHoldMs: this.resolver.getFocusHoldMs(),
      overshootMs: this.resolver.getOvershootMs(),
      microSaccade: this.resolver.getMicroSaccade(),
      headLagMs: this.headLagMs,
    }
  }

  private applyHeadLag(delta: number): void {
    if (!this.targetInitialized) {
      this.target.position.copy(this.resolvedTarget.position)
      this.target.quaternion.copy(this.resolvedTarget.quaternion)
      this.targetInitialized = true
      this.headLagMs = 0
      return
    }

    const distance = this.target.position.distanceTo(this.resolvedTarget.position)
    const speed =
      this.mode === 'speaking'
        ? avatarLookAtTuning.headLag.speakingSmoothing
        : avatarLookAtTuning.headLag.defaultSmoothing
    const t = 1 - Math.exp(-Math.max(0, delta) * speed)
    this.target.position.lerp(this.resolvedTarget.position, t)
    this.target.quaternion.copy(this.resolvedTarget.quaternion)
    this.target.updateMatrixWorld(true)
    this.headLagMs =
      distance > 0.001
        ? Math.min(
            avatarLookAtTuning.headLag.maxDebugMs,
            (distance / Math.max(0.001, speed)) * 1000,
          )
        : 0
  }

  private applyVrmLookAtTarget(): boolean {
    const lookAt = this.vrm?.lookAt as
      | {
          target?: THREE.Object3D | null
          autoUpdate?: boolean
          reset?: () => void
        }
      | undefined
    if (!lookAt) {
      if (this.baseTarget) console.warn('[vrm] lookAt is not available on this model')
      return false
    }
    lookAt.target = this.baseTarget ? this.target : null
    lookAt.autoUpdate = true
    if (!this.baseTarget) lookAt.reset?.()
    return true
  }

  private clearVrmLookAtTarget(): void {
    const lookAt = this.vrm?.lookAt as
      | {
          target?: THREE.Object3D | null
          autoUpdate?: boolean
          reset?: () => void
        }
      | undefined
    if (!lookAt) return
    lookAt.target = null
    // three-vrm keeps the last applied yaw/pitch when target becomes null.
    // Explicit reset marks a neutral pose for the next vrm.update() instead of
    // leaving the eyes frozen at their last camera/glance direction.
    lookAt.reset?.()
  }
}
