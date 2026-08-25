import { randomUUID } from 'node:crypto'

import type {
  AutonomySettings,
  BehaviorCommand,
  ExperienceEvent,
  WorldContextSnapshot,
} from '../../shared/alive'

const IDLE_REACTION_COOLDOWN_MS = 5 * 60_000

export class BehaviorRuntime {
  private lastIdleReactionAt: number | null = null

  observe(
    event: ExperienceEvent,
    settings: AutonomySettings,
    world: WorldContextSnapshot,
  ): BehaviorCommand | null {
    if (event.type !== 'silence-threshold') return null
    if (
      settings.globallySuspended ||
      settings.privacyMode ||
      settings.mode === 'off' ||
      world.conversationActive ||
      world.audioActive ||
      insideQuietHours(settings, event.at) ||
      (this.lastIdleReactionAt !== null &&
        event.at - this.lastIdleReactionAt < IDLE_REACTION_COOLDOWN_MS)
    ) {
      return null
    }
    this.lastIdleReactionAt = event.at
    return {
      type: 'idle-reaction',
      id: randomUUID(),
      at: event.at,
      intensity: 'subtle',
    }
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
