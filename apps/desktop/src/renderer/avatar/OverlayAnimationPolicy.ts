import type { AvatarStateEffect } from './AvatarStateMachine'
import type { AnimationId } from './animationManifest'

type OverlayAnimationPolicyConfig = {
  alwaysExcluded: readonly AnimationId[]
  idleExcluded: readonly AnimationId[]
  speakingExcluded: readonly AnimationId[]
  reactionExcluded: readonly AnimationId[]
}

const OVERLAY_ANIMATION_POLICY = {
  // All bundled S22 gestures are available in both presentation surfaces.
  alwaysExcluded: [],
  idleExcluded: [],
  speakingExcluded: [],
  reactionExcluded: [],
} as const satisfies OverlayAnimationPolicyConfig

export class OverlayAnimationPolicy {
  getExcludedAnimationIds(effect: AvatarStateEffect): AnimationId[] {
    return [...OVERLAY_ANIMATION_POLICY.alwaysExcluded, ...this.getModeExcludedAnimationIds(effect)]
  }

  allows(animationId: string, effect: AvatarStateEffect): boolean {
    return !this.getExcludedAnimationIds(effect).includes(animationId as AnimationId)
  }

  private getModeExcludedAnimationIds(effect: AvatarStateEffect): readonly AnimationId[] {
    switch (effect.mode) {
      case 'idle':
        return OVERLAY_ANIMATION_POLICY.idleExcluded
      case 'speaking':
        return OVERLAY_ANIMATION_POLICY.speakingExcluded
      default:
        return OVERLAY_ANIMATION_POLICY.reactionExcluded
    }
  }
}
