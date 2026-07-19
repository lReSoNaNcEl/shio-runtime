import { emotionRegistry } from '../../shared/emotion'
import type { CharacterState } from '../../shared/runtime/character-state'
import type { AvatarBehaviorId } from './AvatarBehaviorResolver'
import type { AvatarStateEffect } from './AvatarStateMachine'
import { getAnimationsByBehaviorTagForState } from './animationManifest'

export interface AvatarBehaviorEngineDecision {
  intent: AvatarBehaviorId
  replyType: string
  contextSummary: string
  candidateBehaviors: AvatarBehaviorId[]
  pipeline: string[]
}

export class AvatarBehaviorEngine {
  decide(effect: AvatarStateEffect, state?: CharacterState): AvatarBehaviorEngineDecision {
    const pipeline = [
      `runtime:${state?.mode ?? effect.mode}`,
      `speech:${state?.speechState.status ?? 'unknown'}`,
      `activity:${state?.activity ?? 'unknown'}`,
      `attention:${state?.attention.focus ?? 'unknown'}`,
      `emotion:${state?.emotion ?? effect.emotionKey}`,
    ]

    const replyType = this.replyTypeFor(effect, state)
    const candidateBehaviors = this.candidateBehaviorsFor(effect, state)
    const intent = this.firstManifestBackedBehavior(candidateBehaviors, effect.mode) ?? 'neutral'

    return {
      intent,
      replyType,
      contextSummary: pipeline.join(', '),
      candidateBehaviors,
      pipeline: [...pipeline, `replyType:${replyType}`, `intent:${intent}`],
    }
  }

  private candidateBehaviorsFor(
    effect: AvatarStateEffect,
    state?: CharacterState,
  ): AvatarBehaviorId[] {
    if (effect.behaviorId === 'greeting') return ['greeting']

    const mode = state?.mode ?? effect.mode
    const speech = state?.speechState.status
    const activity = state?.activity
    const attention = state?.attention.focus
    const emotion = this.toBehavior(state?.emotion ?? effect.emotionKey)

    if (mode === 'listening' || speech === 'listening' || speech === 'recognizing') {
      return ['listening', 'thinking', 'neutral']
    }

    if (
      mode === 'thinking' ||
      mode === 'awaitingSpeech' ||
      speech === 'generating' ||
      speech === 'synthesizing'
    ) {
      return ['thinking', 'listening', 'neutral']
    }

    if (
      mode === 'speaking' ||
      speech === 'speaking' ||
      activity === 'speaking' ||
      activity === 'answering'
    ) {
      return [emotion, this.replyFallbackFor(emotion), 'neutral']
    }

    if (attention === 'user') return ['listening', 'idle', 'neutral']
    return ['idle', 'calm', 'neutral']
  }

  private replyTypeFor(effect: AvatarStateEffect, state?: CharacterState): string {
    if (effect.behaviorId === 'greeting') return 'greeting'
    const speech = state?.speechState.status
    if (speech === 'speaking' || state?.activity === 'answering')
      return `reply:${state?.emotion || effect.emotionKey}`
    if (speech === 'listening' || state?.activity === 'listening') return 'input:listening'
    if (speech === 'generating' || speech === 'synthesizing') return 'reply:preparing'
    return effect.mode
  }

  private firstManifestBackedBehavior(
    behaviors: AvatarBehaviorId[],
    mode: string,
  ): AvatarBehaviorId | null {
    const state = mode === 'awaitingSpeech' ? 'thinking' : mode
    return (
      behaviors.find((behavior) => {
        return getAnimationsByBehaviorTagForState(`behavior:${behavior}`, state).length > 0
      }) ?? null
    )
  }

  private replyFallbackFor(behavior: AvatarBehaviorId): AvatarBehaviorId {
    switch (behavior) {
      case 'laugh':
        return 'happy'
      case 'sigh':
      case 'groan':
        return 'calm'
      default:
        return 'neutral'
    }
  }

  private toBehavior(emotionKey: string): AvatarBehaviorId {
    return emotionRegistry.avatarBehavior(emotionKey) as AvatarBehaviorId
  }
}
