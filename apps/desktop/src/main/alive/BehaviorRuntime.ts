import { randomUUID } from 'node:crypto'

import type {
  AutonomySettings,
  BehaviorCommand,
  ExperienceAppraisal,
  MoodState,
  WorldContextSnapshot,
} from '../../shared/alive'

const NONVERBAL_COOLDOWN_MS = 90_000
const GAME_NONVERBAL_COOLDOWN_MS = 5_000
const CONVERSATION_CANDIDATE_COOLDOWN_MS = 5 * 60_000
const GAME_CONVERSATION_CANDIDATE_COOLDOWN_MS = 30_000
const GAME_CONVERSATION_WINDOW_MS = 60_000
const GAME_MAX_CONVERSATION_CANDIDATES_PER_WINDOW = 2

export class BehaviorRuntime {
  private lastNonverbalAt: number | null = null
  private lastConversationCandidateAt: number | null = null
  private gameConversationCandidateAt: number[] = []

  decide(input: {
    appraisal: ExperienceAppraisal
    mood: MoodState
    settings: AutonomySettings
    world: WorldContextSnapshot
    at: number
    conversationAllowed?: boolean
  }): BehaviorCommand {
    const { appraisal, settings, at } = input
    const gameEvent = appraisal.origin === 'browser-game'
    if (
      settings.globallySuspended ||
      settings.privacyMode ||
      settings.mode === 'off' ||
      insideQuietHours(settings, at)
    ) {
      return command(at, appraisal.eventId, { kind: 'none' }, appraisal.embodimentPresence)
    }
    if (
      appraisal.conversationalImpulse &&
      appraisal.conversationalImpulse.priority >= 0.65 &&
      input.conversationAllowed !== false &&
      this.conversationCooldownAllows(appraisal, at, gameEvent)
    ) {
      this.lastConversationCandidateAt = at
      if (gameEvent) this.gameConversationCandidateAt.push(at)
      return command(
        at,
        appraisal.eventId,
        {
          kind: 'conversation-candidate',
          topic: appraisal.conversationalImpulse.topic.slice(0, 300),
          priority: boundedUnit(appraisal.conversationalImpulse.priority),
        },
        appraisal.embodimentPresence,
      )
    }
    if (
      appraisal.embodimentHint &&
      (this.lastNonverbalAt === null ||
        at - this.lastNonverbalAt >=
          (gameEvent ? GAME_NONVERBAL_COOLDOWN_MS : NONVERBAL_COOLDOWN_MS))
    ) {
      this.lastNonverbalAt = at
      return command(
        at,
        appraisal.eventId,
        {
          kind: 'embodiment',
          intent: appraisal.embodimentHint,
        },
        appraisal.embodimentPresence,
      )
    }
    return command(at, appraisal.eventId, { kind: 'none' }, appraisal.embodimentPresence)
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

  private conversationCooldownAllows(
    appraisal: ExperienceAppraisal,
    at: number,
    gameEvent: boolean,
  ): boolean {
    if (!gameEvent) {
      return (
        this.lastConversationCandidateAt === null ||
        at - this.lastConversationCandidateAt >= CONVERSATION_CANDIDATE_COOLDOWN_MS
      )
    }
    this.gameConversationCandidateAt = this.gameConversationCandidateAt.filter(
      (candidateAt) => at - candidateAt < GAME_CONVERSATION_WINDOW_MS,
    )
    if ((appraisal.conversationalImpulse?.priority ?? 0) >= 0.98) return true
    if (this.gameConversationCandidateAt.length >= GAME_MAX_CONVERSATION_CANDIDATES_PER_WINDOW) {
      return false
    }
    if ((appraisal.conversationalImpulse?.priority ?? 0) >= 0.9) return true
    return (
      this.lastConversationCandidateAt === null ||
      at - this.lastConversationCandidateAt >= GAME_CONVERSATION_CANDIDATE_COOLDOWN_MS
    )
  }
}

function command(
  at: number,
  sourceEventId: string,
  intent: BehaviorCommand['intent'],
  embodimentPresence?: BehaviorCommand['embodimentPresence'],
): BehaviorCommand {
  return { id: randomUUID(), at, sourceEventId, embodimentPresence, intent }
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
