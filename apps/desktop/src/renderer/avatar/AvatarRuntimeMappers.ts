import type { CharacterState } from '../../shared/runtime/characterState'
import type { HeadMotionProfile } from '../three/HeadMotionRuntime'
import type { LookAtMode } from '../three/LookAtRuntime'
import type { VrmProceduralMode } from '../three/VrmModel'
import type { AvatarMode, AvatarStateEffect } from './AvatarStateMachine'

export function toAvatarMode(mode: CharacterState['mode']): AvatarMode {
  switch (mode) {
    case 'listening':
    case 'thinking':
    case 'awaitingSpeech':
    case 'speaking':
    case 'idle':
      return mode
    case 'acting':
    default:
      return 'idle'
  }
}

export function toLookAtMode(effect: AvatarStateEffect, state?: CharacterState): LookAtMode {
  if (effect.mode === 'speaking') return 'speaking'
  if (effect.mode === 'listening') return 'listening'
  if (effect.mode === 'thinking' || effect.mode === 'awaitingSpeech') return 'thinking'
  if (state?.attention.focus === 'user' && state.attention.confidence >= 0.85) return 'userFocus'
  return 'idle'
}

export function toHeadMotionProfile(mode: LookAtMode): HeadMotionProfile {
  return mode
}

/**
 * Map a Character State mode to the procedural motion profile, matching the
 * AvatarStateMachine effect mapping (awaitingSpeech behaves like thinking). Used
 * to keep the Ear Runtime profile driven by the per-frame render loop so idle /
 * AFK procedural motion keeps progressing without depending on discrete state
 * change events (important for the Mirror Overlay).
 */
export function toProceduralMode(mode: CharacterState['mode']): VrmProceduralMode {
  switch (mode) {
    case 'listening':
      return 'listening'
    case 'thinking':
    case 'awaitingSpeech':
      return 'thinking'
    case 'speaking':
      return 'speaking'
    case 'idle':
    case 'acting':
    case 'interrupted':
    case 'sleeping':
    default:
      return 'idle'
  }
}
