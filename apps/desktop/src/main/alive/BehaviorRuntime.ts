import { randomUUID } from 'node:crypto'

import type {
  AutonomySettings,
  BehaviorCommand,
  ExperienceAppraisal,
  MoodState,
  WorldContextSnapshot,
} from '../../shared/alive'

const NONVERBAL_COOLDOWN_MS = 90_000
const CONVERSATION_CANDIDATE_COOLDOWN_MS = 5 * 60_000

export class BehaviorRuntime {
  private lastNonverbalAt: number | null = null
  private lastConversationCandidateAt: number | null = null

  decide(input: {
    appraisal: ExperienceAppraisal
    mood: MoodState
    settings: AutonomySettings
    world: WorldContextSnapshot
    at: number
  }): BehaviorCommand {
    const { appraisal, settings, world, at } = input
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
      !world.conversationActive &&
      !world.audioActive &&
      (this.lastConversationCandidateAt === null ||
        at - this.lastConversationCandidateAt >= CONVERSATION_CANDIDATE_COOLDOWN_MS)
    ) {
      this.lastConversationCandidateAt = at
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
    return {
      id: randomUUID(),
      at,
      sourceEventId: `scheduled-event-due:${taskId}:${at}`,
      intent: { kind: 'conversation-candidate', topic: title.slice(0, 300), priority: 0.75 },
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
