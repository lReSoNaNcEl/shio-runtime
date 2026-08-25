import type { AutonomySettings, ScheduledTask, WorldContextSnapshot } from '../../shared/alive'

export type AutonomyDecision =
  | { outcome: 'execute' }
  | { outcome: 'preview'; reason: 'suggest_mode' | 'confirmation_required' }
  | {
      outcome: 'defer'
      reason: 'suspended' | 'off' | 'privacy' | 'quiet_hours' | 'busy' | 'cooldown' | 'daily_cap'
      retryAt: number
    }

export class AutonomyEnvelope {
  decide(input: {
    task: ScheduledTask
    settings: AutonomySettings
    world: WorldContextSnapshot
    now: number
    dailyInitiatives: number
    lastInitiativeAt: number | null
  }): AutonomyDecision {
    const { settings, world, now } = input
    if (settings.globallySuspended)
      return { outcome: 'defer', reason: 'suspended', retryAt: now + 60_000 }
    if (settings.mode === 'off') return { outcome: 'defer', reason: 'off', retryAt: now + 60_000 }
    if (settings.privacyMode) return { outcome: 'defer', reason: 'privacy', retryAt: now + 60_000 }
    if (insideQuietHours(settings, now))
      return { outcome: 'defer', reason: 'quiet_hours', retryAt: now + 15 * 60_000 }
    if (world.conversationActive || world.audioActive)
      return { outcome: 'defer', reason: 'busy', retryAt: now + 30_000 }
    if (input.lastInitiativeAt !== null && now - input.lastInitiativeAt < settings.cooldownMs) {
      return {
        outcome: 'defer',
        reason: 'cooldown',
        retryAt: input.lastInitiativeAt + settings.cooldownMs,
      }
    }
    if (input.dailyInitiatives >= settings.maxDailyInitiatives)
      return { outcome: 'defer', reason: 'daily_cap', retryAt: nextLocalDay(now) }
    if (settings.mode === 'suggest') return { outcome: 'preview', reason: 'suggest_mode' }
    if (settings.mode === 'confirm') return { outcome: 'preview', reason: 'confirmation_required' }
    return { outcome: 'execute' }
  }
}

function insideQuietHours(settings: AutonomySettings, now: number): boolean {
  if (!settings.quietHours.enabled) return false
  const hour = new Date(now).getHours()
  const { startHour, endHour } = settings.quietHours
  return startHour === endHour
    ? true
    : startHour < endHour
      ? hour >= startHour && hour < endHour
      : hour >= startHour || hour < endHour
}

function nextLocalDay(now: number): number {
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  return next.getTime()
}
