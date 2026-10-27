import type { VRM } from '@pixiv/three-vrm'

import { SeededRandom, smoothUnit } from './SeededMotion'

export interface BreathProfile {
  /** Approximate complete breath cycles per second. */
  speed?: number
  intensity?: number
  weight?: number
  smoothing?: number
}

export interface BreathDebugState {
  offsetY: number
  phase: number
  cycleSeconds: number
  limit: number
}

let breathInstanceSequence = 0

export class BreathController {
  private vrm: VRM | null = null
  private phase = 0
  private offsetY = 0
  private smoothedY = 0
  private speed = 0.2
  private intensity = 0.008
  private weight = 1
  private smoothing = 3
  private cycleSeconds = 5
  private cycleAmplitude = 1
  private readonly random: SeededRandom

  constructor(seed = 0x51f15e + ++breathInstanceSequence * 7919) {
    this.random = new SeededRandom(seed)
    this.randomizeCycle()
  }

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm
    this.phase = this.random.next()
    this.offsetY = 0
    this.smoothedY = 0
    this.randomizeCycle()
  }

  detach(): void {
    this.remove()
    this.vrm = null
    this.phase = 0
    this.offsetY = 0
    this.smoothedY = 0
  }

  setProfile(profile: BreathProfile): void {
    this.speed = profile.speed ?? this.speed
    this.intensity = profile.intensity ?? this.intensity
    this.weight = profile.weight ?? this.weight
    this.smoothing = profile.smoothing ?? this.smoothing
  }

  remove(): void {
    if (!this.vrm?.humanoid || this.offsetY === 0) return

    const chest = this.vrm.humanoid.getNormalizedBoneNode('chest')
    if (chest) chest.position.y -= this.offsetY
    this.offsetY = 0
  }

  update(delta: number): void {
    if (!this.vrm?.humanoid) return

    this.phase += Math.max(0, delta) / Math.max(0.5, this.cycleSeconds)
    while (this.phase >= 1) {
      this.phase -= 1
      this.randomizeCycle()
    }

    const target = this.resolveBreathEnvelope() * this.intensity * this.weight * this.cycleAmplitude
    const blend = 1 - Math.exp(-Math.max(0, this.smoothing) * Math.max(0, delta))
    const limit = Math.abs(this.intensity * this.weight) * 1.15
    // Removing last frame's bone contribution must not reset the envelope.
    const next = Math.max(
      -limit,
      Math.min(limit, this.smoothedY + (target - this.smoothedY) * blend),
    )
    const chest = this.vrm.humanoid.getNormalizedBoneNode('chest')

    if (chest) chest.position.y += next - this.offsetY
    this.offsetY = next
    this.smoothedY = next
  }

  getDebugState(): BreathDebugState {
    return {
      offsetY: this.offsetY,
      phase: this.phase,
      cycleSeconds: this.cycleSeconds,
      limit: Math.abs(this.intensity * this.weight) * 1.15,
    }
  }

  private randomizeCycle(): void {
    const baseCycleSeconds = 1 / Math.max(0.08, this.speed)
    this.cycleSeconds = baseCycleSeconds * this.random.range(0.84, 1.18)
    this.cycleAmplitude = this.random.range(0.78, 1.08)
  }

  private resolveBreathEnvelope(): number {
    const inhaleEnd = 0.43
    const holdEnd = 0.51
    if (this.phase < inhaleEnd) return smoothUnit(this.phase / inhaleEnd) - 0.42
    if (this.phase < holdEnd) return 0.58
    const exhale = smoothUnit((this.phase - holdEnd) / (1 - holdEnd))
    return 0.58 - exhale
  }
}
