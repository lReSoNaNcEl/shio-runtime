import type { AvatarStateEffect } from './AvatarStateMachine'
import type { AnimationId } from './animationManifest'

type OverlayAnimationPolicyConfig = {
  alwaysExcluded: readonly AnimationId[]
  idleExcluded: readonly AnimationId[]
  speakingExcluded: readonly AnimationId[]
  reactionExcluded: readonly AnimationId[]
}

const OVERLAY_ANIMATION_POLICY = {
  // `afk_swing_02` reads poorly in the Mirror Overlay framing (compact swing
  // motion clips through the tighter overlay camera), so the overlay never
  // selects it. The main avatar may still use it — this exclusion is overlay
  // only. The behavior resolver skips excluded ids and falls back safely
  // (getFallbackAnimationId honours the exclusion set), so the mirror simply
  // picks another idle-presence clip instead.
  alwaysExcluded: ['neutral2', 'afk_swing_02'],
  idleExcluded: [],
  speakingExcluded: [],
  reactionExcluded: []
} as const satisfies OverlayAnimationPolicyConfig

export class OverlayAnimationPolicy {
  getExcludedAnimationIds(effect: AvatarStateEffect): AnimationId[] {
    return [
      ...OVERLAY_ANIMATION_POLICY.alwaysExcluded,
      ...this.getModeExcludedAnimationIds(effect)
    ]
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
