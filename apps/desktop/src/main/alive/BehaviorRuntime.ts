import { randomUUID } from 'node:crypto'

import type {
  AutonomySettings,
  BehaviorCommand,
  ExperienceAppraisal,
  MoodState,
  WorldContextSnapshot,
} from '../../shared/alive'

const NONVERBAL_COOLDOWN_MS = 90_000

export class BehaviorRuntime {
  private lastNonverbalAt: number | null = null

  decide(input: {
    appraisal: ExperienceAppraisal
    mood: MoodState
    settings: AutonomySettings
    world: WorldContextSnapshot
    at: number
    conversationAllowed?: boolean
  }): BehaviorCommand {
    const { appraisal, settings, at } = input
    if (
      settings.globallySuspended ||
      settings.privacyMode ||
      settings.mode === 'off' ||
      insideQuietHours(settings, at)
    ) {
      return command(at, appraisal.eventId, { kind: 'none' })
    }
    if (
      appraisal.conversationalImpulse &&
      appraisal.conversationalImpulse.priority >= 0.65 &&
      input.conversationAllowed !== false
    ) {
      return command(at, appraisal.eventId, {
        kind: 'conversation-candidate',
        topic: appraisal.conversationalImpulse.topic.slice(0, 300),
        priority: boundedUnit(appraisal.conversationalImpulse.priority),
      })
    }
    if (
      appraisal.embodimentHint &&
      (this.lastNonverbalAt === null || at - this.lastNonverbalAt >= NONVERBAL_COOLDOWN_MS)
    ) {
      this.lastNonverbalAt = at
      return command(at, appraisal.eventId, {
        kind: 'embodiment',
        intent: appraisal.embodimentHint,
      })
    }
    return command(at, appraisal.eventId, { kind: 'none' })
  }

  scheduledInitiative(taskId: string, title: string, at: number): BehaviorCommand {
    return this.proactiveInitiative(`scheduled-event-due:${taskId}:${at}`, title, 0.75, at)
  }

  proactiveInitiative(
    sourceEventId: string,
    topic: string,
    priority: number,
    at: number,
  ): BehaviorCommand {
    return {
      id: randomUUID(),
      at,
      sourceEventId: sourceEventId.slice(0, 160),
      intent: {
        kind: 'conversation-candidate',
        topic: topic.slice(0, 300),
        priority: boundedUnit(priority),
      },
    }
  }
}

function command(
  at: number,
  sourceEventId: string,
  intent: BehaviorCommand['intent'],
): BehaviorCommand {
  return { id: randomUUID(), at, sourceEventId, intent }
}

function boundedUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
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
