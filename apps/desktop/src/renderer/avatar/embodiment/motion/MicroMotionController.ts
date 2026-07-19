import type { VRM } from '@pixiv/three-vrm'

export interface MicroMotionProfile {
  swayWeight?: number
  eyeWeight?: number
  headWeight?: number
  headSpeed?: number
}

export class MicroMotionController {
  private vrm: VRM | null = null
  private swayPhase = 0
  private eyePhase = 0
  private headPhase = 0
  private swayWeight = 0.55
  private eyeWeight = 0.55
  private headWeight = 0.25
  private headSpeed = 0.65
  private lookAtActive = false
  private spineOffsetZ = 0
  private headOffsetX = 0
  private headOffsetY = 0
  private leftEyeOffsetX = 0
  private leftEyeOffsetY = 0
  private rightEyeOffsetX = 0
  private rightEyeOffsetY = 0
  private impulseTime = 0
  private impulseDuration = 1
  private impulseHeadX = 0
  private impulseHeadY = 0
  private impulseEyeX = 0
  private impulseEyeY = 0

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm
    this.swayPhase = Math.random() * Math.PI * 2
    this.eyePhase = Math.random() * Math.PI * 2
    this.headPhase = Math.random() * Math.PI * 2
  }

  detach(): void {
    this.remove()
    this.vrm = null
    this.resetOffsets()
    this.clearImpulse()
  }

  setProfile(profile: MicroMotionProfile): void {
    this.swayWeight = profile.swayWeight ?? this.swayWeight
    this.eyeWeight = profile.eyeWeight ?? this.eyeWeight
    this.headWeight = profile.headWeight ?? this.headWeight
    this.headSpeed = profile.headSpeed ?? this.headSpeed
  }

  setLookAtActive(active: boolean): void {
    this.lookAtActive = active
    if (active) this.removeEyeOffsets()
  }

  nudge(options: {
    headX?: number
    headY?: number
    eyeX?: number
    eyeY?: number
    duration?: number
  }): void {
    this.impulseHeadX = options.headX ?? 0
    this.impulseHeadY = options.headY ?? 0
    this.impulseEyeX = options.eyeX ?? 0
    this.impulseEyeY = options.eyeY ?? 0
    this.impulseDuration = Math.max(0.4, options.duration ?? 1.6)
    this.impulseTime = this.impulseDuration
  }

  remove(): void {
    if (!this.vrm?.humanoid) return

    const spine = this.vrm.humanoid.getNormalizedBoneNode('spine')
    if (spine) spine.rotation.z -= this.spineOffsetZ

    const head = this.vrm.humanoid.getNormalizedBoneNode('head')
    if (head) {
      head.rotation.x -= this.headOffsetX
      head.rotation.y -= this.headOffsetY
    }

    this.removeEyeOffsets()
    this.spineOffsetZ = 0
    this.headOffsetX = 0
    this.headOffsetY = 0
  }

  update(delta: number): void {
    if (!this.vrm?.humanoid) return

    this.updateImpulse(delta)
    this.updateSway(delta)
    this.updateHead(delta)
    this.updateEyes(delta)
  }

  private updateSway(delta: number): void {
    if (!this.vrm?.humanoid) return

    this.swayPhase += delta * 0.3
    const target = Math.sin(this.swayPhase) * 0.006 * this.swayWeight
    const next = this.lerp(this.spineOffsetZ, target, Math.min(1, delta * 3))
    const spine = this.vrm.humanoid.getNormalizedBoneNode('spine')

    if (spine) spine.rotation.z += next - this.spineOffsetZ
    this.spineOffsetZ = next
  }

  private updateHead(delta: number): void {
    if (!this.vrm?.humanoid) return

    this.headPhase += delta * this.headSpeed
    const impulse = this.getImpulseEnvelope()
    const targetX =
      Math.sin(this.headPhase * 0.7) * 0.012 * this.headWeight + this.impulseHeadX * impulse
    const targetY = Math.sin(this.headPhase) * 0.018 * this.headWeight + this.impulseHeadY * impulse
    const nextX = this.lerp(this.headOffsetX, targetX, Math.min(1, delta * 2.4))
    const nextY = this.lerp(this.headOffsetY, targetY, Math.min(1, delta * 2.4))
    const head = this.vrm.humanoid.getNormalizedBoneNode('head')

    if (head) {
      head.rotation.x += nextX - this.headOffsetX
      head.rotation.y += nextY - this.headOffsetY
    }

    this.headOffsetX = nextX
    this.headOffsetY = nextY
  }

  private updateEyes(delta: number): void {
    if (!this.vrm?.humanoid) return
    if (this.lookAtActive) {
      this.removeEyeOffsets()
      return
    }

    this.eyePhase += delta * 0.45
    const impulse = this.getImpulseEnvelope()
    const targetX =
      Math.sin(this.eyePhase * 1.4) * 0.015 * this.eyeWeight + this.impulseEyeX * impulse
    const targetY =
      Math.sin(this.eyePhase * 0.9) * 0.025 * this.eyeWeight + this.impulseEyeY * impulse
    const nextX = this.lerp(this.leftEyeOffsetX, targetX, Math.min(1, delta * 2))
    const nextY = this.lerp(this.leftEyeOffsetY, targetY, Math.min(1, delta * 2))
    const leftEye = this.vrm.humanoid.getNormalizedBoneNode('leftEye')
    const rightEye = this.vrm.humanoid.getNormalizedBoneNode('rightEye')

    if (leftEye) {
      leftEye.rotation.x += nextX - this.leftEyeOffsetX
      leftEye.rotation.y += nextY - this.leftEyeOffsetY
    }

    if (rightEye) {
      rightEye.rotation.x += nextX - this.rightEyeOffsetX
      rightEye.rotation.y += nextY - this.rightEyeOffsetY
    }

    this.leftEyeOffsetX = nextX
    this.leftEyeOffsetY = nextY
    this.rightEyeOffsetX = nextX
    this.rightEyeOffsetY = nextY
  }

  private removeEyeOffsets(): void {
    if (!this.vrm?.humanoid) {
      this.leftEyeOffsetX = 0
      this.leftEyeOffsetY = 0
      this.rightEyeOffsetX = 0
      this.rightEyeOffsetY = 0
      return
    }

    const leftEye = this.vrm.humanoid.getNormalizedBoneNode('leftEye')
    if (leftEye) {
      leftEye.rotation.x -= this.leftEyeOffsetX
      leftEye.rotation.y -= this.leftEyeOffsetY
    }

    const rightEye = this.vrm.humanoid.getNormalizedBoneNode('rightEye')
    if (rightEye) {
      rightEye.rotation.x -= this.rightEyeOffsetX
      rightEye.rotation.y -= this.rightEyeOffsetY
    }

    this.leftEyeOffsetX = 0
    this.leftEyeOffsetY = 0
    this.rightEyeOffsetX = 0
    this.rightEyeOffsetY = 0
  }

  private resetOffsets(): void {
    this.spineOffsetZ = 0
    this.headOffsetX = 0
    this.headOffsetY = 0
    this.leftEyeOffsetX = 0
    this.leftEyeOffsetY = 0
    this.rightEyeOffsetX = 0
    this.rightEyeOffsetY = 0
  }

  private updateImpulse(delta: number): void {
    if (this.impulseTime <= 0) return
    this.impulseTime = Math.max(0, this.impulseTime - delta)
    if (this.impulseTime === 0) this.clearImpulse()
  }

  private getImpulseEnvelope(): number {
    if (this.impulseTime <= 0) return 0
    const progress = 1 - this.impulseTime / this.impulseDuration
    return Math.sin(Math.PI * Math.max(0, Math.min(1, progress)))
  }

  private clearImpulse(): void {
    this.impulseTime = 0
    this.impulseHeadX = 0
    this.impulseHeadY = 0
    this.impulseEyeX = 0
    this.impulseEyeY = 0
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }
}
