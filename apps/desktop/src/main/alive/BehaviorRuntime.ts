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

export type ConversationCandidateDisposition =
  | 'not-requested'
  | 'selected'
  | 'suppressed-policy'
  | 'suppressed-threshold'
  | 'suppressed-busy'
  | 'suppressed-cooldown'
  | 'suppressed-budget'

export interface BehaviorDecision {
  command: BehaviorCommand
  conversationCandidate: ConversationCandidateDisposition
}

interface BehaviorDecisionInput {
  appraisal: ExperienceAppraisal
  mood: MoodState
  settings: AutonomySettings
  world: WorldContextSnapshot
  at: number
  conversationAllowed?: boolean
}

export class BehaviorRuntime {
  private lastNonverbalAt: number | null = null
  private lastConversationCandidateAt: number | null = null
  private gameConversationCandidateAt: number[] = []

  decide(input: BehaviorDecisionInput): BehaviorCommand {
    return this.decideWithDiagnostics(input).command
  }

  assessConversationCandidate(input: BehaviorDecisionInput): ConversationCandidateDisposition {
    const { appraisal, settings, at } = input
    const conversationalImpulse = appraisal.conversationalImpulse
    if (!conversationalImpulse) return 'not-requested'
    if (
      settings.globallySuspended ||
      settings.privacyMode ||
      settings.mode === 'off' ||
      insideQuietHours(settings, at) ||
      input.conversationAllowed === false
    ) {
      return 'suppressed-policy'
    }
    if (conversationalImpulse.priority < 0.65) return 'suppressed-threshold'
    const gate = this.conversationGate(appraisal, at, appraisal.origin === 'browser-game')
    if (gate === 'budget') return 'suppressed-budget'
    return gate === 'cooldown' ? 'suppressed-cooldown' : 'selected'
  }

  decideWithDiagnostics(input: BehaviorDecisionInput): BehaviorDecision {
    const { appraisal, settings, at } = input
    const gameEvent = appraisal.origin === 'browser-game'
    const conversationCandidate = this.assessConversationCandidate(input)
    if (
      settings.globallySuspended ||
      settings.privacyMode ||
      settings.mode === 'off' ||
      insideQuietHours(settings, at)
    ) {
      return decision(
        command(at, appraisal.eventId, { kind: 'none' }, appraisal.embodimentPresence),
        conversationCandidate,
      )
    }
    const conversationalImpulse = appraisal.conversationalImpulse
    if (conversationalImpulse && conversationCandidate === 'selected') {
      this.lastConversationCandidateAt = at
      if (gameEvent) {
        this.gameConversationCandidateAt = this.recentGameConversationCandidates(at)
        this.gameConversationCandidateAt.push(at)
      }
      return decision(
        command(
          at,
          appraisal.eventId,
          {
            kind: 'conversation-candidate',
            topic: conversationalImpulse.topic.slice(0, 300),
            priority: boundedUnit(conversationalImpulse.priority),
          },
          appraisal.embodimentPresence,
        ),
        conversationCandidate,
      )
    }
    if (
      appraisal.embodimentHint &&
      (this.lastNonverbalAt === null ||
        at - this.lastNonverbalAt >=
          (gameEvent ? GAME_NONVERBAL_COOLDOWN_MS : NONVERBAL_COOLDOWN_MS))
    ) {
      this.lastNonverbalAt = at
      return decision(
        command(
          at,
          appraisal.eventId,
          {
            kind: 'embodiment',
            intent: appraisal.embodimentHint,
          },
          appraisal.embodimentPresence,
        ),
        conversationCandidate,
      )
    }
    return decision(
      command(at, appraisal.eventId, { kind: 'none' }, appraisal.embodimentPresence),
      conversationCandidate,
    )
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

  private conversationGate(
    appraisal: ExperienceAppraisal,
    at: number,
    gameEvent: boolean,
  ): 'allow' | 'cooldown' | 'budget' {
    if (!gameEvent) {
      return this.lastConversationCandidateAt === null ||
        at - this.lastConversationCandidateAt >= CONVERSATION_CANDIDATE_COOLDOWN_MS
        ? 'allow'
        : 'cooldown'
    }
    if ((appraisal.conversationalImpulse?.priority ?? 0) >= 0.98) return 'allow'
    if (
      this.recentGameConversationCandidates(at).length >=
      GAME_MAX_CONVERSATION_CANDIDATES_PER_WINDOW
    ) {
      return 'budget'
    }
    if ((appraisal.conversationalImpulse?.priority ?? 0) >= 0.9) return 'allow'
    return this.lastConversationCandidateAt === null ||
      at - this.lastConversationCandidateAt >= GAME_CONVERSATION_CANDIDATE_COOLDOWN_MS
      ? 'allow'
      : 'cooldown'
  }

  private recentGameConversationCandidates(at: number): number[] {
    return this.gameConversationCandidateAt.filter(
      (candidateAt) => at - candidateAt < GAME_CONVERSATION_WINDOW_MS,
    )
  }
}

function decision(
  command: BehaviorCommand,
  conversationCandidate: ConversationCandidateDisposition,
): BehaviorDecision {
  return { command, conversationCandidate }
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
