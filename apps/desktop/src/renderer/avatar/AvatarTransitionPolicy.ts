import type { AvatarMode } from './AvatarStateMachine'

export type AvatarTransitionPolicyId =
  | 'initial'
  | 'idle-to-idle'
  | 'idle-to-speaking'
  | 'speaking-to-idle'
  | 'thinking-to-idle'
  | 'greeting-to-idle'
  | 'default'

export interface AvatarTransitionContext {
  fromAnimationId: string | null
  toAnimationId: string
  fromMode: AvatarMode | null
  toMode: AvatarMode
  fromBehaviorId: string | null
  toBehaviorId: string
}

export interface AvatarTransitionDecision {
  policyId: AvatarTransitionPolicyId
  blendDuration: number
  restartRequired: boolean
}

const DEFAULT_DECISION: AvatarTransitionDecision = {
  policyId: 'default',
  blendDuration: 0.35,
  restartRequired: false
}

export class AvatarTransitionPolicy {
  resolve(context: AvatarTransitionContext): AvatarTransitionDecision {
    if (context.fromAnimationId === context.toAnimationId) {
      return { policyId: 'default', blendDuration: 0, restartRequired: false }
    }

    if (!context.fromAnimationId) return { policyId: 'initial', blendDuration: 0.3, restartRequired: false }

    if (context.fromMode === 'idle' && context.toMode === 'idle') {
      // Slow, soft crossfade between calm resting poses.
      return { policyId: 'idle-to-idle', blendDuration: 0.7, restartRequired: false }
    }

    if (context.fromMode === 'idle' && context.toMode === 'speaking') {
      // Snappy: react quickly when Shio starts talking.
      return { policyId: 'idle-to-speaking', blendDuration: 0.2, restartRequired: false }
    }

    if (context.fromMode === 'speaking' && context.toMode === 'idle') {
      // Longer settle so Shio eases back into the resting pose after speaking.
      return { policyId: 'speaking-to-idle', blendDuration: 0.6, restartRequired: false }
    }

    if (context.fromMode === 'thinking' && context.toMode === 'idle') {
      return { policyId: 'thinking-to-idle', blendDuration: 0.6, restartRequired: false }
    }

    if (context.fromBehaviorId === 'greeting' && context.toMode === 'idle') {
      return { policyId: 'greeting-to-idle', blendDuration: 0.6, restartRequired: false }
    }

    return DEFAULT_DECISION
  }
}
