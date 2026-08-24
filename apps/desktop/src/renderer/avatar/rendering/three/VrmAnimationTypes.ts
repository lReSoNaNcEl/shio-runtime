import type { AvatarBodyMotionLayer } from '../../embodiment/motion/AvatarMotionLayer'

export type VrmRootMotionPolicy = 'allow' | 'lockY' | 'lockXZ' | 'lockAll'

export interface VrmAnimationLoadContext {
  animationId: string
  file: string
  behaviorId: string
  source: string
  reason: string
  previousAnimationId: string | null
  forceReplay: boolean
  frame?: number
  rootMotionPolicy: VrmRootMotionPolicy
  motionLayer: AvatarBodyMotionLayer
}
