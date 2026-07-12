import type { VRM } from '@pixiv/three-vrm'
import { releaseValue, type FacialEasingId } from './facialEasing'
import { getFacialProfile, type FacialProfile } from './FacialProfile'

/**
 * ExpressionController — Emotion source.
 *
 * Maps an emotion key (or an explicit VRM expression string) to a set of target
 * expression weights. Rising toward a new emotion uses an exponential attack;
 * falling toward zero uses the centralized, duration-based eased release in
 * {@link facialEasing} so emotions fade naturally through an explicit
 *
 *   active -> release -> inactive
 *
 * lifecycle instead of snapping. It owns the *emotion* domain only (never mouth,
 * never blink) and does not write into the VRM Expression Manager: the
 * AvatarExpressionMixer reads {@link getValues} each frame and performs the
 * authoritative facial write.
 */

const MOUTH_EXPRESSIONS = new Set<string>(['aa', 'ih', 'ou', 'ee', 'oh'])

/** Per-expression release (fade-out) progress, tracked only while releasing. */
interface ReleaseState {
  startValue: number
  elapsedMs: number
  holdMs: number
}

export class ExpressionController {
  private attached = false
  private targets = new Map<string, number>()
  private weights = new Map<string, number>()
  private releases = new Map<string, ReleaseState>()
  private profile: FacialProfile = getFacialProfile('neutral')
  private frame = 0
  private speechEnergy = 0
  private breathPhase = Math.random() * Math.PI * 2

  attach(_vrm: VRM): void {
    this.clear()
    this.attached = true
  }

  detach(): void {
    this.clear()
    this.attached = false
  }

  clear(): void {
    this.targets.clear()
    this.weights.clear()
    this.releases.clear()
  }

  applyEmotion(emotionKey: string, vrmEmotion?: string): void {
    this.targets.clear()

    this.profile = getFacialProfile(emotionKey)
    const preset = {
      ...this.profile.expressionWeights,
      ...(this.parseVrmEmotion(vrmEmotion) ?? {})
    }
    for (const [name, weight] of Object.entries(preset)) {
      // Mouth is owned by the LipSync domain — never contributed by emotion.
      if (MOUTH_EXPRESSIONS.has(name)) continue
      this.targets.set(name, this.clamp(weight))
    }
    console.log(
      `[FACETRACE] source=Emotion event=APPLY emotion=${emotionKey} profile=${this.profile.id} targets=[${[...this.targets].map(([n, w]) => `${n}:${w.toFixed(2)}`).join(',')}] frame=${this.frame} t=${Math.round(performance.now())}ms`
    )
  }

  update(delta: number): void {
    if (!this.attached) return
    this.frame += 1
    this.breathPhase += Math.max(0, delta) * this.profile.expressionMotion.breathSpeed

    const deltaMs = Math.max(0, delta) * 1000
    const attackT = Math.min(1, Math.max(0, delta) * this.profile.releaseProfile.attackPerSecond)
    const releaseDurationMs = Math.max(1, this.profile.releaseProfile.releaseDurationMs)
    const easing = this.profile.releaseProfile.curve as FacialEasingId

    const names = new Set([...this.weights.keys(), ...this.targets.keys()])
    for (const name of names) {
      const current = this.weights.get(name) ?? 0
      const baseTarget = this.targets.get(name) ?? 0
      const target = baseTarget > 0 ? this.applySpeechBreath(baseTarget, name) : 0

      if (target > current) {
        // Attack — rising toward a newly requested emotion. Cancel any release.
        this.releases.delete(name)
        this.weights.set(name, this.lerp(current, target, attackT))
        continue
      }

      if (target > 0) {
        // Holding / easing down to a non-zero target (blend between emotions).
        this.releases.delete(name)
        this.weights.set(name, this.lerp(current, target, attackT))
        continue
      }

      // target === 0 → centralized eased release toward inactive.
      let release = this.releases.get(name)
      if (!release) {
        if (current <= 0.001) {
          this.weights.delete(name)
          continue
        }
        release = { startValue: current, elapsedMs: 0, holdMs: this.profile.releaseProfile.holdMs }
        this.releases.set(name, release)
        this.logLifecycle('release', name, 0)
      }
      release.elapsedMs += deltaMs
      if (release.elapsedMs < release.holdMs) {
        this.weights.set(name, release.startValue)
        continue
      }
      const progress = Math.min(1, (release.elapsedMs - release.holdMs) / releaseDurationMs)
      const next = releaseValue(release.startValue, progress, easing)
      if (next <= 0 || progress >= 1) {
        this.weights.delete(name)
        this.releases.delete(name)
        this.logLifecycle('inactive', name, 1)
      } else {
        this.weights.set(name, next)
      }
    }
  }

  private logLifecycle(state: 'release' | 'inactive', expression: string, progress: number): void {
    console.log(
      `[FACELIFE] source=Emotion state=${state} expression=${expression} frame=${this.frame} t=${Math.round(performance.now())}ms release=${progress.toFixed(2)}`
    )
  }

  /** Current emotion-domain expression weights for the Expression Mixer. */
  getValues(): Map<string, number> {
    return this.weights
  }

  getProfile(): FacialProfile {
    return this.profile
  }

  setSpeechEnergy(energy: number): void {
    this.speechEnergy = this.clamp(energy)
  }

  private parseVrmEmotion(vrmEmotion?: string): Record<string, number> | null {
    if (!vrmEmotion) return null
    const result: Record<string, number> = {}

    for (const part of vrmEmotion.split(',')) {
      const [rawName, rawWeight] = part.split(':')
      const name = rawName?.trim()
      if (!name) continue
      const weight = Number(rawWeight)
      result[name] = Number.isFinite(weight) ? weight : 1
    }

    return Object.keys(result).length ? result : null
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value))
  }

  private applySpeechBreath(target: number, name: string): number {
    const motion = this.profile.expressionMotion
    if (motion.breathAmplitude <= 0) return target
    const nameOffset = this.hashName(name) * 0.37
    const slowBreath = Math.sin(this.breathPhase + nameOffset) * 0.5 + 0.5
    const activeAmount = motion.breathAmplitude * (0.35 + this.speechEnergy * motion.speakingBoost)
    return this.clamp(target * (1 - activeAmount * 0.45 + slowBreath * activeAmount))
  }

  private hashName(name: string): number {
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 997
    return hash / 997
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }
}
