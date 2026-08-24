import type { VRM } from '@pixiv/three-vrm'
import type * as THREE from 'three'

import { type AvatarRigProfile, DEFAULT_AVATAR_RIG_PROFILE } from '../../AvatarRigProfile'
import { BoundedRandomMotionChannel, SeededRandom } from '../motion/SeededMotion'
import type { AvatarProceduralMode } from '../types'

export interface TailBehaviorDebugState {
  available: boolean
  boneNames: string[]
  yawOffset: number
  rollOffset: number
  limit: number
}

const PROFILE_WEIGHT: Record<AvatarProceduralMode, number> = {
  idle: 1,
  listening: 0.62,
  thinking: 0.52,
  speaking: 0.82,
}

let tailInstanceSequence = 0

export class TailBehaviorRuntime {
  private vrm: VRM | null = null
  private bones: THREE.Object3D[] = []
  private appliedYaw: number[] = []
  private appliedRoll: number[] = []
  private mode: AvatarProceduralMode = 'idle'
  private emotionScale = 1
  private poseBias = 0
  private yawOffset = 0
  private rollOffset = 0
  private readonly yawChannel: BoundedRandomMotionChannel
  private readonly rollChannel: BoundedRandomMotionChannel

  constructor(
    seed = 0x14b7a9 + ++tailInstanceSequence * 32452843,
    private readonly rigProfile: AvatarRigProfile = DEFAULT_AVATAR_RIG_PROFILE,
  ) {
    this.yawChannel = new BoundedRandomMotionChannel(new SeededRandom(seed ^ 0x528f8a61), {
      amplitude: 0.075,
      intervalSeconds: { min: 2.2, max: 5.6 },
      stiffness: 3.2,
      damping: 3.7,
    })
    this.rollChannel = new BoundedRandomMotionChannel(new SeededRandom(seed ^ 0x1d34c5b7), {
      amplitude: 0.035,
      intervalSeconds: { min: 3.4, max: 7.4 },
      stiffness: 2.8,
      damping: 3.4,
    })
  }

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm
    this.bones = this.detectTailChain(vrm.scene)
    this.appliedYaw = this.bones.map(() => 0)
    this.appliedRoll = this.bones.map(() => 0)
  }

  detach(): void {
    this.remove()
    this.vrm = null
    this.yawChannel.reset()
    this.rollChannel.reset()
    this.bones = []
    this.appliedYaw = []
    this.appliedRoll = []
    this.yawOffset = 0
    this.rollOffset = 0
  }

  setProfile(mode: AvatarProceduralMode): void {
    this.mode = mode
  }

  applyEmotion(emotionId: string): void {
    switch (emotionId) {
      case 'happy':
      case 'laugh':
        this.emotionScale = 1.28
        this.poseBias = 0.012
        return
      case 'surprised':
        this.emotionScale = 1.1
        this.poseBias = 0.025
        return
      case 'sad':
      case 'crying':
        this.emotionScale = 0.44
        this.poseBias = -0.018
        return
      case 'angry':
        this.emotionScale = 0.66
        this.poseBias = -0.01
        return
      default:
        this.emotionScale = 1
        this.poseBias = 0
    }
  }

  remove(): void {
    for (let index = 0; index < this.bones.length; index += 1) {
      const bone = this.bones[index]
      bone.rotation.y -= this.appliedYaw[index] ?? 0
      bone.rotation.z -= this.appliedRoll[index] ?? 0
      this.appliedYaw[index] = 0
      this.appliedRoll[index] = 0
    }
  }

  update(delta: number): void {
    if (!this.vrm || this.bones.length === 0) return
    const weight = PROFILE_WEIGHT[this.mode] * this.emotionScale
    this.yawOffset = clampSigned(this.yawChannel.update(delta) * weight + this.poseBias, 0.1)
    this.rollOffset = clampSigned(this.rollChannel.update(delta) * weight, 0.055)

    const denominator = Math.max(1, this.bones.length - 1)
    for (let index = 0; index < this.bones.length; index += 1) {
      const falloff = 1 - (index / denominator) * 0.58
      const yaw = this.yawOffset * falloff
      const roll = this.rollOffset * falloff
      const bone = this.bones[index]
      bone.rotation.y += yaw - (this.appliedYaw[index] ?? 0)
      bone.rotation.z += roll - (this.appliedRoll[index] ?? 0)
      this.appliedYaw[index] = yaw
      this.appliedRoll[index] = roll
    }
  }

  getDebugState(): TailBehaviorDebugState {
    return {
      available: this.bones.length > 0,
      boneNames: this.bones.map((bone) => bone.name),
      yawOffset: this.yawOffset,
      rollOffset: this.rollOffset,
      limit: 0.1,
    }
  }

  private detectTailChain(scene: THREE.Object3D): THREE.Object3D[] {
    const profile = this.rigProfile.secondaryMotion?.tail
    if (!profile) return []
    const matches = (node: THREE.Object3D): boolean => {
      const name = node.name.toLocaleLowerCase()
      return (
        profile.boneNamePatterns.some((pattern) => name.includes(pattern.toLocaleLowerCase())) &&
        !profile.boneNameExcludes.some((pattern) => name.includes(pattern.toLocaleLowerCase()))
      )
    }
    const roots: THREE.Object3D[] = []
    scene.traverse((node) => {
      if (matches(node) && (!node.parent || !matches(node.parent))) roots.push(node)
    })

    let best: THREE.Object3D[] = []
    for (const root of roots) {
      const chain = [root]
      let current = root
      while (chain.length < profile.maximumChainLength) {
        const child = current.children.find(matches)
        if (!child) break
        chain.push(child)
        current = child
      }
      if (chain.length >= profile.minimumChainLength && chain.length > best.length) best = chain
    }
    return best
  }
}

function clampSigned(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
}
