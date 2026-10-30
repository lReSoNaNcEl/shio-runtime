import type { AutonomySettings } from '../../shared/alive'

/** Authoritative autonomy policy stops, in their established precedence. */
export type AutonomyPolicyStop = 'suspended' | 'privacy' | 'off' | 'quiet-hours'
/** Momentary owners of the character's attention that silence autonomous presence. */
export type AutonomyBusyStop = 'conversation' | 'audio' | 'screen-focus'

export function insideQuietHours(settings: AutonomySettings, now: number): boolean {
  if (!settings.quietHours.enabled) return false
  const hour = new Date(now).getHours()
  const { startHour, endHour } = settings.quietHours
  return startHour === endHour
    ? true
    : startHour < endHour
      ? hour >= startHour && hour < endHour
      : hour >= startHour || hour < endHour
}

/** Global Suspend, Privacy Mode, Off and (optionally) quiet hours stop every autonomous owner. */
export function autonomyPolicyStop(
  settings: AutonomySettings,
  at: number,
  options: { quietHours: boolean },
): AutonomyPolicyStop | null {
  if (settings.globallySuspended) return 'suspended'
  if (settings.privacyMode) return 'privacy'
  if (settings.mode === 'off') return 'off'
  if (options.quietHours && insideQuietHours(settings, at)) return 'quiet-hours'
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
