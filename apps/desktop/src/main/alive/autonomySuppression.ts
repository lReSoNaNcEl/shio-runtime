import type { AutonomySettings } from '../../shared/alive'

/** Authoritative autonomy policy stops, in their established precedence. */
export type AutonomyPolicyStop = 'suspended' | 'privacy' | 'off'
/** Momentary owners of the character's attention that silence autonomous presence. */
export type AutonomyBusyStop = 'conversation' | 'audio' | 'screen-focus'

export function autonomyPolicyStop(settings: AutonomySettings): AutonomyPolicyStop | null {
  if (settings.globallySuspended) return 'suspended'
  if (settings.privacyMode) return 'privacy'
  if (settings.mode === 'off') return 'off'
  return null
}

/** Active conversation, audible output and delegated browser screen focus keep presence quiet. */
export function autonomyBusyStop(input: {
  conversationActive: boolean
  audioActive: boolean
  browserComputerUseScreenFocusActive: boolean
}): AutonomyBusyStop | null {
  if (input.conversationActive) return 'conversation'
  if (input.audioActive) return 'audio'
  if (input.browserComputerUseScreenFocusActive) return 'screen-focus'
  return null
}
