import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import type { EmotionEmbodimentProfile } from '../avatar/EmotionEmbodimentProfile'
import { earBehaviorTuning, semanticEarTuning } from './avatarTuning'
import type { VrmProceduralMode } from './VrmModel'

/**
 * EarBehaviorRuntime — expressive procedural fox-ear animation layer.
 *
 * An independent Avatar Runtime animation source (sibling of Blink, LookAt and
 * HeadMotion). It derives ear poses only from runtime-visible Character State
 * (mode + emotion) plus an internal idle timer for the AFK escalation. It never
 * inspects reply text, System Prompt, or any LLM/provider detail.
 *
 * Design: pose-driven, not noise-driven. Each ear procedurally transitions
 * between named poses on its own independent timeline (with occasional
 * synchronized moves), layered on a per-profile base pose and shifted by the
 * current emotion. Rotations are applied around a rig-calibrated local axis so
 * the motion is actually visible on the real VRM skeleton instead of twisting
 * the bone around its own length. If ear bones are missing the runtime disables
 * itself gracefully and the avatar keeps running.
 */
export type EarBehaviorProfile = VrmProceduralMode | 'afk'
export type EarSide = 'left' | 'right' | 'center'
export type EarGestureId =
  | 'relaxed'
  | 'perk'
  | 'curious'
  | 'tilt'
  | 'flatten'
  | 'emphasis'
  | 'droop'
export type EarAxisOverride = 'auto' | 'x' | 'y' | 'z'
export type EarImpulse =
  | 'user-interruption'
  | 'direct-address'
  | 'question'
  | 'thinking-entry'
  | 'reply-emphasis'
  | 'recognition-uncertain'

export interface EarPose {
  lift: number
  spread: number
}

export interface EarDebugState {
  boneName: string
  detectedAxis: string
  restPose: string
  pose: EarGestureId
  basePose: EarPose
  speakingModifier: EarPose
  finalPose: EarPose
  currentLift: number
  currentSpread: number
  targetLift: number
  targetSpread: number
  currentRotationRad: number
  targetRotationRad: number
  nextEventMs: number
}

export interface EarBehaviorDebugState {
  enabled: boolean
  boneStatus: string
  profile: EarBehaviorProfile
  emotion: string
  axisOverride: EarAxisOverride
  amplitudeScale: number
  idleMs: number
  updateTickCount: number
  lastDeltaMs: number
  activeImpulse: EarImpulse | null
  left: EarDebugState | null
  right: EarDebugState | null
}

interface EarState {
  node: THREE.Object3D
  side: EarSide
  boneName: string
  restQuat: THREE.Quaternion
  primaryAxis: THREE.Vector3
  secondaryAxis: THREE.Vector3
  primarySign: number
  spreadSign: number
  detectedAxis: string
  // Normalized pose state (interpolated toward the current gesture target).
  currentLift: number
  currentSpread: number
  targetLift: number
  targetSpread: number
  // Debug decomposition of the last composed target (semantic base + speaking).
  baseLift: number
  baseSpread: number
  modLift: number
  modSpread: number
  gesture: EarGestureId
  smoothing: number
  nextEventMs: number
}

interface ActiveEarImpulse {
  type: EarImpulse
  identity?: string
  remainingMs: number
}

export interface EarImpulseDecision {
  accepted: boolean
  impulse: EarImpulse
  reason: string
}

const ZERO_POSE: EarPose = { lift: 0, spread: 0 }

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const AXIS_BY_ID: Record<'x' | 'y' | 'z', THREE.Vector3> = { x: X_AXIS, y: Y_AXIS, z: Z_AXIS }
const AXIS_LABELS: Array<{ id: 'x' | 'y' | 'z'; axis: THREE.Vector3; label: string }> = [
  { id: 'x', axis: X_AXIS, label: 'X' },
  { id: 'y', axis: Y_AXIS, label: 'Y' },
  { id: 'z', axis: Z_AXIS, label: 'Z' },
]

export class EarBehaviorRuntime {
  private static seedCounter = 0

  private static nextSeed(): number {
    const entropy = typeof performance !== 'undefined' ? performance.now() : Date.now()
    return (
      (earBehaviorTuning.randomSeed +
        Math.floor(entropy) +
        EarBehaviorRuntime.seedCounter++ * 0x9e3779b1) >>>
      0
    )
  }

  private vrm: VRM | null = null
  private ears: EarState[] = []
  private boneStatus = 'not-initialized'
  private baseProfile: VrmProceduralMode = 'idle'
  private emotionProfile: EmotionEmbodimentProfile = {
    id: 'neutral',
    facialKey: 'neutral',
    lipSyncProfile: 'neutral',
    ear: { lift: 0, spread: 0, amplitudeScale: 1 },
    head: { energyScale: 1, nodBias: 1, tiltBias: 1 },
    animationTags: ['behavior:neutral'],
  }
  private idleMs = 0
  private surpriseMs = 0
  private activeImpulse: ActiveEarImpulse | null = null
  private impulseCooldowns = new Map<EarImpulse, number>()
  private thinkingEntryTriggered = false
  private lastReplyEmphasisIdentity: string | null = null
  private lastImpulseDecision: EarImpulseDecision | null = null
  // Per-instance random stream. Seeded with construction-time entropy + an
  // instance counter so independent instances (e.g. the main avatar and the
  // Mirror Overlay) never share a timeline and are not frame-for-frame identical.
  private randomState: number = EarBehaviorRuntime.nextSeed()
  private axisOverride: EarAxisOverride = 'auto'
  private amplitudeScale = 1
  // Diagnostics: prove the per-instance update loop is actually ticking (used to
  // compare the main avatar vs the Mirror Overlay instance).
  private updateTickCount = 0
  private lastDeltaMs = 0

  // Preallocated scratch objects — reused every frame, never allocated in update.
  private readonly scratchQuatPrimary = new THREE.Quaternion()
  private readonly scratchQuatSecondary = new THREE.Quaternion()
  // Calibration scratch (used only at attach time).
  private readonly calibWorldPos = new THREE.Vector3()
  private readonly calibChildPos = new THREE.Vector3()
  private readonly calibWorldQuat = new THREE.Quaternion()
  private readonly calibInvQuat = new THREE.Quaternion()
  private readonly calibEarDir = new THREE.Vector3()
  private readonly calibTip = new THREE.Vector3()
  private readonly calibCross = new THREE.Vector3()

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm
    this.ears = this.discoverEars(vrm)
    this.boneStatus = this.describeBoneStatus()
    if (this.ears.length === 0) {
      console.log('[EARDBG] no ear bones found — Ear Behavior Runtime disabled for this model')
    } else {
      const axes = this.ears.map((ear) => `${ear.boneName}:${ear.detectedAxis}`).join(' ')
      console.log(
        `[EARDBG] Ear Behavior Runtime attached bones=${this.boneStatus} calibration=[${axes}]`,
      )
    }
  }

  detach(): void {
    this.remove()
    this.vrm = null
    this.ears = []
    this.boneStatus = 'not-initialized'
    this.idleMs = 0
    this.surpriseMs = 0
    this.activeImpulse = null
    this.impulseCooldowns.clear()
    this.thinkingEntryTriggered = false
    this.lastReplyEmphasisIdentity = null
    this.lastImpulseDecision = null
  }

  /** Restore ear bones to their rest pose (used on detach / model swap). */
  remove(): void {
    for (const ear of this.ears) {
      ear.node.quaternion.copy(ear.restQuat)
    }
  }

  setProfile(mode: VrmProceduralMode): void {
    if (mode !== this.baseProfile && mode !== 'idle') this.idleMs = 0
    if (mode !== this.baseProfile && mode === 'thinking') this.thinkingEntryTriggered = false
    if (mode !== 'thinking') this.thinkingEntryTriggered = false
    this.baseProfile = mode
  }

  applyEmotion(profile: EmotionEmbodimentProfile): void {
    const next = profile.id
    if (next === this.emotionProfile.id) return
    if (next === 'surprised' && this.emotionProfile.id !== 'surprised') {
      this.surpriseMs = earBehaviorTuning.surpriseImpulse.durationMs
    }
    this.emotionProfile = {
      ...profile,
      ear: { ...profile.ear },
      head: { ...profile.head },
      animationTags: [...profile.animationTags],
    }
  }

  /** Debug: force a specific local rotation axis (or 'auto' for calibration). */
  setAxisOverride(axis: EarAxisOverride): void {
    this.axisOverride = axis
  }

  /** Debug: scale overall visible amplitude to sanity-check rig assumptions. */
  setAmplitudeScale(scale: number): void {
    this.amplitudeScale = THREE.MathUtils.clamp(scale, 0, 4)
  }

  triggerImpulse(impulse: EarImpulse, identity?: string): boolean {
    const reject = (reason: string): boolean => {
      this.lastImpulseDecision = { accepted: false, impulse, reason }
      return false
    }
    if ((this.impulseCooldowns.get(impulse) ?? 0) > 0) return reject('cooldown')
    if (impulse === 'thinking-entry' && this.thinkingEntryTriggered)
      return reject('already-triggered-for-thinking-entry')
    if (impulse === 'reply-emphasis' && identity && identity === this.lastReplyEmphasisIdentity)
      return reject('already-triggered-for-segment')
    if (
      this.activeImpulse &&
      semanticEarTuning.priority[impulse] <= semanticEarTuning.priority[this.activeImpulse.type]
    )
      return reject(`lower-priority-than-${this.activeImpulse.type}`)

    const tuning = semanticEarTuning.impulses[impulse]
    const replacedImpulse = this.activeImpulse?.type ?? null
    this.activeImpulse = {
      type: impulse,
      identity,
      remainingMs: tuning.attackMs + tuning.holdMs + tuning.releaseMs,
    }
    if (tuning.cooldownMs > 0) this.impulseCooldowns.set(impulse, tuning.cooldownMs)
    if (impulse === 'thinking-entry') this.thinkingEntryTriggered = true
    if (impulse === 'reply-emphasis') this.lastReplyEmphasisIdentity = identity ?? null
    this.lastImpulseDecision = {
      accepted: true,
      impulse,
      reason: replacedImpulse ? `replaced-${replacedImpulse}` : 'started',
    }
    return true
  }

  getLastImpulseDecision(): EarImpulseDecision | null {
    return this.lastImpulseDecision ? { ...this.lastImpulseDecision } : null
  }

  update(delta: number): void {
    // Count ticks BEFORE any early return so the debug panel can distinguish
    // "runtime is not being updated at all" from "updated but no ear bones".
    this.updateTickCount += 1
    this.lastDeltaMs = delta * 1000
    const deltaMs = delta * 1000
    for (const [impulse, remaining] of this.impulseCooldowns) {
      const next = Math.max(0, remaining - deltaMs)
      if (next <= 0) this.impulseCooldowns.delete(impulse)
      else this.impulseCooldowns.set(impulse, next)
    }
    if (this.activeImpulse) {
      this.activeImpulse.remainingMs = Math.max(0, this.activeImpulse.remainingMs - deltaMs)
      if (this.activeImpulse.remainingMs <= 0) this.activeImpulse = null
    }

    if (!this.vrm || this.ears.length === 0) return

    if (this.baseProfile === 'idle') this.idleMs += deltaMs
    if (this.surpriseMs > 0) this.surpriseMs = Math.max(0, this.surpriseMs - deltaMs)

    const profile = this.effectiveProfile()
    const tuning = earBehaviorTuning.profiles[profile]
    const base = this.computeBasePose(profile)
    const emo = this.emotionProfile.ear
    const amplitudeScale = emo.amplitudeScale * this.amplitudeScale
    const impulse = this.activeImpulse ? 0 : this.surpriseImpulseValue()
    const semanticEnvelope = this.semanticImpulseValue()
    // Speaking is an ADDITIVE modifier layered on top of the held pose, not a
    // replacement, so the ears keep whatever pose they had and just feel slightly
    // more alive while talking.
    const speakingMod = profile === 'speaking' ? earBehaviorTuning.speakingModifier : ZERO_POSE

    for (const ear of this.ears) {
      ear.nextEventMs -= deltaMs
      if (ear.nextEventMs <= 0) {
        this.scheduleEvent(ear, profile, tuning)
      }

      const gesture = earBehaviorTuning.gestures[ear.gesture]
      // Semantic base pose = profile base + gesture + emotion (emotion MODIFIES,
      // it never replaces). The speaking modifier is tracked separately so pose
      // composition stays legible in the debug panel.
      ear.baseLift = base.lift + gesture.lift + (emo?.lift ?? 0)
      ear.baseSpread = base.spread + gesture.spread + (emo?.spread ?? 0)
      ear.modLift = speakingMod.lift
      ear.modSpread = speakingMod.spread
      ear.targetLift = ear.baseLift + ear.modLift
      ear.targetSpread = ear.baseSpread + ear.modSpread

      const blend = 1 - Math.exp(-ear.smoothing * delta)
      ear.currentLift = THREE.MathUtils.lerp(ear.currentLift, ear.targetLift, blend)
      ear.currentSpread = THREE.MathUtils.lerp(ear.currentSpread, ear.targetSpread, blend)

      // Lift swings the tip vertically/forward (calibrated) — it never converges.
      const semanticPose = this.semanticImpulsePose(ear.side)
      const liftNorm = ear.currentLift + impulse + semanticEnvelope * semanticPose.lift
      const liftRad = this.clamp(liftNorm * tuning.amplitude * amplitudeScale)
      // Spread is positive-outward; inward folding is hard-limited so the ears
      // can never cross toward each other.
      const spreadOutward = THREE.MathUtils.clamp(
        (ear.currentSpread + semanticEnvelope * semanticPose.spread) *
          tuning.spreadAmplitude *
          amplitudeScale,
        -earBehaviorTuning.maxInwardSpread,
        earBehaviorTuning.maxRotation,
      )

      // Always start from the calibrated rest pose; apply motion as a local offset.
      const primaryAxis = this.resolvePrimaryAxis(ear)
      this.scratchQuatPrimary.setFromAxisAngle(primaryAxis, liftRad * ear.primarySign)
      ear.node.quaternion.copy(ear.restQuat).multiply(this.scratchQuatPrimary)
      if (this.axisOverride === 'auto') {
        this.scratchQuatSecondary.setFromAxisAngle(
          ear.secondaryAxis,
          spreadOutward * ear.spreadSign,
        )
        ear.node.quaternion.multiply(this.scratchQuatSecondary)
      }
    }
  }

  getDebugState(): EarBehaviorDebugState {
    const left = this.ears.find((ear) => ear.side === 'left') ?? this.ears[0] ?? null
    const right = this.ears.find((ear) => ear.side === 'right') ?? this.ears[1] ?? null
    return {
      enabled: this.ears.length > 0,
      boneStatus: this.boneStatus,
      profile: this.effectiveProfile(),
      emotion: this.emotionProfile.id,
      axisOverride: this.axisOverride,
      amplitudeScale: this.amplitudeScale,
      idleMs: this.idleMs,
      updateTickCount: this.updateTickCount,
      lastDeltaMs: this.lastDeltaMs,
      activeImpulse: this.activeImpulse?.type ?? null,
      left: this.earDebug(left),
      right: this.earDebug(right === left ? null : right),
    }
  }

  private earDebug(ear: EarState | null): EarDebugState | null {
    if (!ear) return null
    const profile = this.effectiveProfile()
    const tuning = earBehaviorTuning.profiles[profile]
    const amplitudeScale = this.emotionProfile.ear.amplitudeScale * this.amplitudeScale
    return {
      boneName: ear.boneName,
      detectedAxis: ear.detectedAxis,
      restPose: `calibrated (${ear.detectedAxis})`,
      pose: ear.gesture,
      basePose: { lift: ear.baseLift, spread: ear.baseSpread },
      speakingModifier: { lift: ear.modLift, spread: ear.modSpread },
      finalPose: { lift: ear.targetLift, spread: ear.targetSpread },
      currentLift: ear.currentLift,
      currentSpread: ear.currentSpread,
      targetLift: ear.targetLift,
      targetSpread: ear.targetSpread,
      currentRotationRad:
        this.clamp(ear.currentLift * tuning.amplitude * amplitudeScale) * ear.primarySign,
      targetRotationRad:
        this.clamp(ear.targetLift * tuning.amplitude * amplitudeScale) * ear.primarySign,
      nextEventMs: Math.max(0, ear.nextEventMs),
    }
  }

  private scheduleEvent(
    ear: EarState,
    profile: EarBehaviorProfile,
    tuning: (typeof earBehaviorTuning.profiles)[EarBehaviorProfile],
  ): void {
    this.pickGesture(ear, tuning)
    ear.nextEventMs = this.randomRange(tuning.holdMs.min, tuning.holdMs.max)
    ear.smoothing = this.smoothingFor(tuning)

    // Occasionally move both ears together for a natural synchronized beat.
    if (this.nextRandom() < earBehaviorTuning.simultaneousMoveChance) {
      for (const other of this.ears) {
        if (other === ear) continue
        this.pickGesture(other, tuning)
        other.nextEventMs = this.randomRange(tuning.holdMs.min, tuning.holdMs.max)
        other.smoothing = ear.smoothing
      }
    }
    void profile
  }

  private pickGesture(
    ear: EarState,
    tuning: (typeof earBehaviorTuning.profiles)[EarBehaviorProfile],
  ): void {
    if (this.nextRandom() < tuning.curiosityChance) {
      const pool = tuning.activeGestures
      ear.gesture = pool[Math.floor(this.nextRandom() * pool.length)] ?? 'relaxed'
    } else {
      ear.gesture = 'relaxed'
    }
  }

  private smoothingFor(tuning: (typeof earBehaviorTuning.profiles)[EarBehaviorProfile]): number {
    const transitionMs = this.randomRange(tuning.transitionMs.min, tuning.transitionMs.max)
    // ~95% of the way to target within transitionMs (1 - e^-3 ≈ 0.95).
    return 3000 / Math.max(1, transitionMs)
  }

  private surpriseImpulseValue(): number {
    if (this.surpriseMs <= 0) return 0
    const { lift, attackMs, durationMs } = earBehaviorTuning.surpriseImpulse
    const elapsed = durationMs - this.surpriseMs
    const envelope =
      elapsed < attackMs
        ? elapsed / Math.max(1, attackMs)
        : Math.max(0, this.surpriseMs / Math.max(1, durationMs - attackMs))
    return lift * envelope
  }

  private semanticImpulseValue(): number {
    if (!this.activeImpulse) return 0
    const { attackMs, holdMs, releaseMs } = semanticEarTuning.impulses[this.activeImpulse.type]
    const durationMs = attackMs + holdMs + releaseMs
    const elapsed = durationMs - this.activeImpulse.remainingMs
    if (elapsed < attackMs) return elapsed / Math.max(1, attackMs)
    if (elapsed < attackMs + holdMs) return 1
    return Math.max(0, this.activeImpulse.remainingMs / Math.max(1, releaseMs))
  }

  private semanticImpulsePose(side: EarSide): EarPose {
    if (!this.activeImpulse) return ZERO_POSE
    const tuning = semanticEarTuning.impulses[this.activeImpulse.type]
    if (side === 'left') return tuning.left
    if (side === 'right') return tuning.right
    return {
      lift: (tuning.left.lift + tuning.right.lift) / 2,
      spread: (tuning.left.spread + tuning.right.spread) / 2,
    }
  }

  private effectiveProfile(): EarBehaviorProfile {
    if (this.baseProfile === 'idle' && this.idleMs >= earBehaviorTuning.afkAfterMs) return 'afk'
    return this.baseProfile
  }

  private computeBasePose(profile: EarBehaviorProfile): EarPose {
    return earBehaviorTuning.profileBasePose[profile]
  }

  private resolvePrimaryAxis(ear: EarState): THREE.Vector3 {
    if (this.axisOverride === 'auto') return ear.primaryAxis
    return AXIS_BY_ID[this.axisOverride]
  }

  private discoverEars(vrm: VRM): EarState[] {
    const matched: THREE.Object3D[] = []
    const matchedSet = new Set<THREE.Object3D>()
    vrm.scene.updateWorldMatrix(true, true)
    vrm.scene.traverse((node) => {
      if (this.isEarBone(node.name)) {
        matched.push(node)
        matchedSet.add(node)
      }
    })

    // Keep only root-most ear bones so a spring-bone chain is not double-rotated.
    const roots = matched.filter((node) => !this.hasAncestorIn(node, matchedSet))

    return roots.map((node, index) => {
      const calibration = this.calibrateAxis(node)
      return {
        node,
        side: this.classifyEarSide(node.name),
        boneName: node.name || `ear-${index}`,
        restQuat: node.quaternion.clone(),
        primaryAxis: calibration.primaryAxis,
        secondaryAxis: calibration.secondaryAxis,
        primarySign: calibration.primarySign,
        spreadSign: calibration.spreadSign,
        detectedAxis: calibration.label,
        currentLift: 0,
        currentSpread: 0,
        targetLift: 0,
        targetSpread: 0,
        baseLift: 0,
        baseSpread: 0,
        modLift: 0,
        modSpread: 0,
        gesture: 'relaxed',
        smoothing: 4,
        nextEventMs: this.randomRange(
          earBehaviorTuning.asymmetry.minOffsetMs,
          earBehaviorTuning.asymmetry.maxOffsetMs,
        ),
      }
    })
  }

  /**
   * Automatic rig calibration tuned for visually pleasing, convergence-free ears.
   *
   * From the ear's length direction (farthest descendant tip) the two axes
   * perpendicular to it are the usable rotation axes; the parallel "twist" axis is
   * rejected. Of the two, the one whose rotation swings the tip most VERTICALLY /
   * forward (least sideways in world X) becomes the primary "lift" axis, so lift
   * can never pull the ears toward each other. The remaining (horizontal) axis is
   * the "spread" axis, and its sign is calibrated so a positive spread always fans
   * the ear OUTWARD, away from the head centre line.
   */
  private calibrateAxis(node: THREE.Object3D): {
    primaryAxis: THREE.Vector3
    secondaryAxis: THREE.Vector3
    primarySign: number
    spreadSign: number
    label: string
  } {
    node.updateWorldMatrix(true, false)
    node.getWorldPosition(this.calibWorldPos)
    node.getWorldQuaternion(this.calibWorldQuat)
    this.calibInvQuat.copy(this.calibWorldQuat).invert()

    // Farthest descendant = ear tip.
    let maxDist = -1
    node.traverse((child) => {
      if (child === node) return
      child.getWorldPosition(this.calibChildPos)
      const dist = this.calibChildPos.distanceTo(this.calibWorldPos)
      if (dist > maxDist) {
        maxDist = dist
        this.calibTip.copy(this.calibChildPos)
      }
    })

    // Outward direction in world X for this ear (relative to its parent / head).
    let parentX = 0
    if (node.parent) {
      node.parent.getWorldPosition(this.calibChildPos)
      parentX = this.calibChildPos.x
    }
    const outwardSign = this.calibWorldPos.x - parentX >= 0 ? 1 : -1

    const fallback = AXIS_BY_ID[earBehaviorTuning.calibration.fallbackAxis]
    if (maxDist < earBehaviorTuning.calibration.tipMinLength) {
      const secondary = fallback.equals(Y_AXIS) ? X_AXIS : Y_AXIS
      return {
        primaryAxis: fallback.clone(),
        secondaryAxis: secondary.clone(),
        primarySign: 1,
        spreadSign: outwardSign,
        label: `${earBehaviorTuning.calibration.fallbackAxis.toUpperCase()}? (no tip)`,
      }
    }

    // Ear length direction expressed in the bone's local frame.
    this.calibEarDir
      .copy(this.calibTip)
      .sub(this.calibWorldPos)
      .applyQuaternion(this.calibInvQuat)
      .normalize()

    // Two most-perpendicular axes are usable; the third (twist) is rejected.
    const ranked = AXIS_LABELS.map((entry) => ({
      ...entry,
      perpendicularity: 1 - Math.abs(entry.axis.dot(this.calibEarDir)),
    })).sort((a, b) => b.perpendicularity - a.perpendicularity)
    const candidateA = ranked[0]
    const candidateB = ranked[1]

    // World-space tip velocity for a +rotation about each candidate axis.
    this.calibCross
      .copy(candidateA.axis)
      .cross(this.calibEarDir)
      .applyQuaternion(this.calibWorldQuat)
    const aVel = { x: this.calibCross.x, y: this.calibCross.y }
    this.calibCross
      .copy(candidateB.axis)
      .cross(this.calibEarDir)
      .applyQuaternion(this.calibWorldQuat)
    const bVel = { x: this.calibCross.x, y: this.calibCross.y }

    // Primary lift = the axis that swings the tip least sideways (most vertical/
    // forward); secondary spread = the horizontal one.
    const aIsLift = Math.abs(aVel.x) <= Math.abs(bVel.x)
    const primary = aIsLift ? candidateA : candidateB
    const secondary = aIsLift ? candidateB : candidateA
    const primaryVel = aIsLift ? aVel : bVel
    const secondaryVel = aIsLift ? bVel : aVel

    // +lift should raise the tip (world +Y); +spread should move it outward.
    const primarySign = primaryVel.y >= 0 ? 1 : -1
    const spreadSign = secondaryVel.x * outwardSign >= 0 ? 1 : -1

    return {
      primaryAxis: primary.axis.clone(),
      secondaryAxis: secondary.axis.clone(),
      primarySign,
      spreadSign,
      label: `${primary.label}${primarySign > 0 ? '+' : '-'} / ${secondary.label}${spreadSign > 0 ? '+' : '-'}(out)`,
    }
  }

  private isEarBone(name: string): boolean {
    const n = name.toLowerCase()
    if (earBehaviorTuning.boneNameExcludes.some((pattern) => n.includes(pattern))) return false
    return earBehaviorTuning.boneNamePatterns.some((pattern) => n.includes(pattern))
  }

  private hasAncestorIn(node: THREE.Object3D, set: Set<THREE.Object3D>): boolean {
    let parent = node.parent
    while (parent) {
      if (set.has(parent)) return true
      parent = parent.parent
    }
    return false
  }

  private classifyEarSide(name: string): EarSide {
    const n = name.toLowerCase()
    const tokens = n.split(/[^a-z]+/).filter(Boolean)
    if (n.includes('right') || tokens.includes('r')) return 'right'
    if (n.includes('left') || tokens.includes('l')) return 'left'
    if (n.endsWith('r')) return 'right'
    if (n.endsWith('l')) return 'left'
    return 'center'
  }

  private describeBoneStatus(): string {
    if (this.ears.length === 0) return 'missing'
    const left = this.ears.filter((ear) => ear.side === 'left').length
    const right = this.ears.filter((ear) => ear.side === 'right').length
    const center = this.ears.filter((ear) => ear.side === 'center').length
    const parts: string[] = []
    if (left) parts.push(`${left}L`)
    if (right) parts.push(`${right}R`)
    if (center) parts.push(`${center}C`)
    return parts.join('+')
  }

  private clamp(value: number): number {
    return THREE.MathUtils.clamp(
      value,
      -earBehaviorTuning.maxRotation,
      earBehaviorTuning.maxRotation,
    )
  }

  private randomRange(min: number, max: number): number {
    return min + this.nextRandom() * Math.max(0, max - min)
  }

  private nextRandom(): number {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0
    return this.randomState / 4294967296
  }
}
