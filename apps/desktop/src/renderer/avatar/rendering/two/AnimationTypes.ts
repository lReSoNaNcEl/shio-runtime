import type { AvatarBodyMotionLayer } from '../../embodiment/motion/AvatarMotionLayer'

export interface AvatarAnimationLoadContext {
  animationId: string
  file: string
  behaviorId: string
  source: string
  reason: string
  previousAnimationId: string | null
  forceReplay: boolean
  frame?: number
  motionLayer: AvatarBodyMotionLayer
}
