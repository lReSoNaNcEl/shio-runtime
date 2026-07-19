import type { VRM } from '@pixiv/three-vrm'

export interface BreathProfile {
  speed?: number
  intensity?: number
  weight?: number
  smoothing?: number
}

export class BreathController {
  private vrm: VRM | null = null
  private phase = 0
  private offsetY = 0
  private speed = 0.4
  private intensity = 0.008
  private weight = 1
  private smoothing = 3

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm
    this.phase = Math.random() * Math.PI * 2
    this.offsetY = 0
  }

  detach(): void {
    this.remove()
    this.vrm = null
    this.phase = 0
    this.offsetY = 0
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

    this.phase += delta * this.speed
    const target = Math.sin(this.phase) * this.intensity * this.weight
    const next = this.lerp(this.offsetY, target, Math.min(1, delta * this.smoothing))
    const chest = this.vrm.humanoid.getNormalizedBoneNode('chest')

    if (chest) chest.position.y += next - this.offsetY
    this.offsetY = next
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }
}
