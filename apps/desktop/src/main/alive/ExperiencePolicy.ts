import type {
  ExperienceAppraisal,
  ExperienceEvent,
  MoodState,
  PersistentGoal,
} from '../../shared/alive'
import type { GameSemanticEvent } from '../../shared/browser-game'
import type { RelationshipContext } from '../../shared/memory'

const RECENT_EXPERIENCE_WINDOW_MS = 30 * 60_000
const MAX_RECENT_EXPERIENCES = 32

export interface ExperiencePolicyContext {
  currentMood: MoodState
  goal?: PersistentGoal
  relationship?: RelationshipContext
}

interface RecentExperience {
  similarityKey: string
  entityId: string
  at: number
}

/** Deterministic authority for base appraisal plus bounded typed contextual modifiers. */
export class ExperiencePolicy {
  private recent: RecentExperience[] = []

  appraise(event: ExperienceEvent, context: ExperiencePolicyContext): ExperienceAppraisal {
    const recent = this.recent.filter(
      (entry) => entry.at <= event.at && event.at - entry.at <= RECENT_EXPERIENCE_WINDOW_MS,
    )
    const similar = recent.filter((entry) => entry.similarityKey === similarityKey(event))
    const failure = isFailureEvent(event)
    const repeatedFailures = failure ? similar.length : 0
    const appraisal = applyContextualModifiers(baseAppraisal(event), event, context, {
      similarCount: similar.length,
      repeatedFailures,
    })
    this.recent = [
      ...recent,
      { similarityKey: similarityKey(event), entityId: eventEntity(event), at: event.at },
    ].slice(-MAX_RECENT_EXPERIENCES)
    return bounded(appraisal)
  }
}

function applyContextualModifiers(
  base: ExperienceAppraisal,
  event: ExperienceEvent,
  context: ExperiencePolicyContext,
  recent: { similarCount: number; repeatedFailures: number },
): ExperienceAppraisal {
  const curiosity = unit(context.currentMood.curiosity)
  const frustration = unit(context.currentMood.frustration)
  const goal = isGoalEvent(event) ? context.goal : undefined
  const importance = goal ? goalImportance(goal) : 0.5
  const relationshipRelevant =
    event.type.startsWith('conversation-') || goal?.owner === 'shared' || goal?.owner === 'user'
  const relationship = relationshipRelevant ? context.relationship : undefined
  const motifCount = Math.min(4, relationship?.recurringMotifs.length ?? 0)
  const noveltyModifier =
    recent.similarCount === 0 ? 0.08 : -Math.min(0.18, recent.similarCount * 0.04)
  const failureSalience = Math.min(0.12, recent.repeatedFailures * 0.04)
  const failureArousal = Math.min(0.09, recent.repeatedFailures * 0.03)
  const relationshipSocial = relationship
    ? (unit(relationship.warmth) - 0.35) * 0.12 + unit(relationship.familiarity) * 0.05
    : 0
  const ownerSocial = goal?.owner === 'shared' ? 0.12 : goal?.owner === 'user' ? 0.06 : 0
  const moodValence =
    base.valence > 0 ? -frustration * 0.06 : base.valence < 0 ? -frustration * 0.03 : 0
  const conversationalImpulse = base.conversationalImpulse
    ? {
        topic: contextualTopic(base.conversationalImpulse.topic, event, goal, recent),
        priority:
          base.conversationalImpulse.priority +
          failureSalience * 0.5 +
          (goal ? (importance - 0.5) * 0.08 : 0),
      }
    : undefined
  return {
    ...base,
    salience:
      base.salience +
      failureSalience +
      frustration * (isFailureEvent(event) ? 0.06 : 0) +
      (goal ? (importance - 0.5) * 0.2 : 0),
    valence: base.valence + moodValence,
    arousal: base.arousal + failureArousal + frustration * (isFailureEvent(event) ? 0.04 : 0),
    novelty: base.novelty + noveltyModifier + (curiosity - 0.55) * 0.06 - motifCount * 0.015,
    socialRelevance: base.socialRelevance + relationshipSocial + ownerSocial + motifCount * 0.01,
    ...(conversationalImpulse ? { conversationalImpulse } : {}),
    ...(recent.repeatedFailures >= 2 && frustration >= 0.55 ? { emotionHint: 'angry' } : {}),
  }
}

function contextualTopic(
  baseTopic: string,
  event: ExperienceEvent,
  goal: PersistentGoal | undefined,
  recent: { repeatedFailures: number },
): string {
  if (event.type === 'goal-completed') {
    if (goal?.owner === 'user') return "The user's goal was completed"
    if (goal?.owner === 'shio') return "Shio's goal was completed"
    return 'A shared goal was completed'
  }
  if (event.type === 'goal-failed') {
    const owner =
      goal?.owner === 'user'
        ? "The user's goal"
        : goal?.owner === 'shio'
          ? "Shio's goal"
          : 'A shared goal'
    return `${owner} needs replanning${recent.repeatedFailures > 0 ? ' after repeated failures' : ''}`
  }
  if (event.type === 'action-failed' && recent.repeatedFailures > 0) {
    return `${baseTopic} after repeated attempts`
  }
  return baseTopic
}

function baseAppraisal(event: ExperienceEvent): ExperienceAppraisal {
  const eventId = event.eventId?.slice(0, 160) || eventIdentity(event)
  const base = { eventId, memoryCandidate: undefined }
  switch (event.type) {
    case 'conversation-completed':
      return {
        ...base,
        salience: 0.25,
        valence: 0.25,
        arousal: -0.1,
        novelty: 0.1,
        socialRelevance: 0.7,
        emotionHint: 'warm',
        silence: true,
      }
    case 'conversation-interrupted':
      return {
        ...base,
        salience: 0.65,
        valence: -0.25,
        arousal: 0.45,
        novelty: 0.3,
        socialRelevance: 0.8,
        emotionHint: 'surprised',
        embodimentHint: { intensity: 'subtle', gazeHint: 'user' },
        silence: true,
      }
    case 'task-completed':
      return {
        ...base,
        salience: 0.35,
        valence: 0.4,
        arousal: 0.1,
        novelty: 0.15,
        socialRelevance: 0.35,
        emotionHint: 'happy',
        silence: true,
      }
    case 'silence-threshold':
      return {
        ...base,
        salience: 0.2,
        valence: 0,
        arousal: -0.25,
        novelty: 0.1,
        socialRelevance: 0.25,
        embodimentHint: { intensity: 'subtle', gestureHint: 'think', gazeHint: 'screen' },
        silence: true,
      }
    case 'action-verified':
      return {
        ...base,
        salience: 0.4,
        valence: 0.45,
        arousal: 0.15,
        novelty: event.novelty ?? 0.2,
        socialRelevance: 0.3,
        emotionHint: 'happy',
        silence: true,
      }
    case 'action-failed':
      return {
        ...base,
        salience: 0.82,
        valence: -0.65,
        arousal: 0.65,
        novelty: 0.65,
        socialRelevance: 0.5,
        emotionHint: 'sad',
        embodimentHint: { intensity: 'normal', gestureHint: 'disagree', gazeHint: 'screen' },
        conversationalImpulse: {
          topic: `Action failed${event.code ? `: ${event.code}` : ''}`,
          priority: 0.78,
        },
        silence: false,
      }
    case 'permission-denied':
      return {
        ...base,
        salience: 0.7,
        valence: -0.2,
        arousal: 0.3,
        novelty: 0.35,
        socialRelevance: 0.75,
        emotionHint: 'calm',
        silence: true,
      }
    case 'browser-blocked':
      return {
        ...base,
        salience: 0.72,
        valence: -0.45,
        arousal: 0.5,
        novelty: 0.55,
        socialRelevance: 0.35,
        emotionHint: 'surprised',
        conversationalImpulse: { topic: 'Browser workflow is blocked', priority: 0.7 },
        silence: false,
      }
    case 'browser-recovered':
    case 'runtime-recovered':
      return {
        ...base,
        salience: 0.45,
        valence: 0.35,
        arousal: 0.2,
        novelty: 0.35,
        socialRelevance: 0.25,
        emotionHint: 'calm',
        silence: true,
      }
    case 'goal-progressed':
      return {
        ...base,
        salience: 0.48,
        valence: 0.4,
        arousal: 0.2,
        novelty: 0.25,
        socialRelevance: 0.45,
        emotionHint: 'happy',
        silence: true,
      }
    case 'goal-completed':
      return {
        ...base,
        salience: 0.8,
        valence: 0.8,
        arousal: 0.6,
        novelty: 0.55,
        socialRelevance: 0.65,
        emotionHint: 'happy',
        embodimentHint: { intensity: 'normal', gestureHint: 'celebrate', gazeHint: 'user' },
        conversationalImpulse: { topic: 'A shared goal was completed', priority: 0.8 },
        memoryCandidate: { kind: 'episodic', summary: 'A shared goal was completed.' },
        silence: false,
      }
    case 'goal-failed':
      return {
        ...base,
        salience: 0.88,
        valence: -0.7,
        arousal: 0.6,
        novelty: 0.65,
        socialRelevance: 0.65,
        emotionHint: 'sad',
        conversationalImpulse: { topic: 'A goal needs replanning', priority: 0.82 },
        silence: false,
      }
    case 'scheduled-event-due':
      return {
        ...base,
        salience: 0.65,
        valence: 0.1,
        arousal: 0.35,
        novelty: 0.2,
        socialRelevance: 0.55,
        conversationalImpulse: { topic: 'A scheduled event is due', priority: 0.75 },
        silence: false,
      }
    case 'user-returned':
      return {
        ...base,
        salience: 0.55,
        valence: 0.3,
        arousal: 0.25,
        novelty: Math.min(1, event.idleMs / 3_600_000),
        socialRelevance: 0.75,
        emotionHint: 'warm',
        embodimentHint: { intensity: 'subtle', gazeHint: 'user' },
        silence: true,
      }
    case 'game-event':
      return appraiseGameEvent(event.gameEvent, eventId)
    case 'meaningful-world-context-changed':
      return {
        ...base,
        salience: 0.32,
        valence: 0,
        arousal: 0.1,
        novelty: 0.45,
        socialRelevance: 0.15,
        emotionHint: 'calm',
        silence: true,
      }
  }
}

function appraiseGameEvent(event: GameSemanticEvent, eventId: string): ExperienceAppraisal {
  const base = {
    eventId,
    origin: 'browser-game' as const,
    memoryCandidate: undefined,
    embodimentPresence: {
      source: 'browser-game' as const,
      sessionId: event.sessionId,
      screenGazeActive: keepsScreenGaze(event.type),
    },
  }
  switch (event.type) {
    case 'game-started':
    case 'round-started':
    case 'game-resumed':
      return {
        ...base,
        salience: 0.35,
        valence: 0.2,
        arousal: 0.3,
        novelty: event.type === 'game-started' ? 0.55 : 0.2,
        socialRelevance: 0.25,
        emotionHint: 'calm',
        embodimentHint: { intensity: 'subtle', gazeHint: 'screen' },
        silence: true,
      }
    case 'score-changed':
      return {
        ...base,
        salience: 0.35,
        valence: 0.3,
        arousal: 0.25,
        novelty: 0.15,
        socialRelevance: 0.15,
        emotionHint: 'happy',
        embodimentHint: { intensity: 'subtle', gazeHint: 'screen' },
        silence: true,
      }
    case 'checkpoint':
      return {
        ...base,
        salience: 0.58,
        valence: 0.48,
        arousal: 0.35,
        novelty: 0.4,
        socialRelevance: 0.3,
        emotionHint: 'happy',
        embodimentHint: { intensity: 'subtle', gazeHint: 'screen' },
        conversationalImpulse: { topic: 'A game checkpoint was reached', priority: 0.68 },
        silence: false,
      }
    case 'level-completed':
      return {
        ...base,
        salience: 0.88,
        valence: 0.85,
        arousal: 0.7,
        novelty: 0.65,
        socialRelevance: 0.5,
        emotionHint: 'happy',
        embodimentHint: { intensity: 'normal', gestureHint: 'celebrate', gazeHint: 'screen' },
        conversationalImpulse: { topic: 'The game level was completed', priority: 0.9 },
        silence: false,
      }
    case 'new-record':
      return {
        ...base,
        salience: 0.95,
        valence: 0.95,
        arousal: 0.85,
        novelty: 0.9,
        socialRelevance: 0.6,
        emotionHint: 'happy',
        embodimentHint: { intensity: 'strong', gestureHint: 'celebrate', gazeHint: 'user' },
        conversationalImpulse: { topic: 'A new game record was set', priority: 0.96 },
        silence: false,
      }
    case 'life-lost':
    case 'death':
      return {
        ...base,
        salience: event.type === 'death' ? 0.72 : 0.52,
        valence: event.type === 'death' ? -0.55 : -0.35,
        arousal: 0.55,
        novelty: 0.3,
        socialRelevance: 0.2,
        emotionHint: 'sad',
        embodimentHint: { intensity: 'subtle', gestureHint: 'disagree', gazeHint: 'screen' },
        silence: true,
      }
    case 'retry':
      return {
        ...base,
        salience: 0.42,
        valence: 0.15,
        arousal: 0.4,
        novelty: 0.2,
        socialRelevance: 0.2,
        emotionHint: 'calm',
        embodimentHint: { intensity: 'subtle', gazeHint: 'screen' },
        silence: true,
      }
    case 'stuck':
      return {
        ...base,
        salience: 0.78,
        valence: -0.45,
        arousal: 0.5,
        novelty: 0.55,
        socialRelevance: 0.4,
        emotionHint: 'surprised',
        embodimentHint: { intensity: 'subtle', gestureHint: 'think', gazeHint: 'screen' },
        conversationalImpulse: { topic: 'The game appears to be stuck', priority: 0.78 },
        silence: false,
      }
    case 'game-over':
      return {
        ...base,
        salience: 0.8,
        valence: -0.5,
        arousal: 0.55,
        novelty: 0.45,
        socialRelevance: 0.35,
        emotionHint: 'sad',
        embodimentHint: { intensity: 'normal', gestureHint: 'disagree', gazeHint: 'screen' },
        conversationalImpulse: { topic: 'The game is over', priority: 0.76 },
        silence: false,
      }
    case 'waiting-user':
      return {
        ...base,
        salience: 1,
        valence: -0.2,
        arousal: 0.65,
        novelty: 0.7,
        socialRelevance: 0.9,
        emotionHint: 'calm',
        embodimentHint: { intensity: 'normal', gazeHint: 'user' },
        conversationalImpulse: {
          topic: 'The game session needs user intervention before it can continue',
          priority: 0.98,
        },
        silence: false,
      }
    case 'game-error':
      return {
        ...base,
        salience: 0.92,
        valence: -0.7,
        arousal: 0.7,
        novelty: 0.65,
        socialRelevance: 0.55,
        emotionHint: 'sad',
        embodimentHint: { intensity: 'normal', gestureHint: 'disagree', gazeHint: 'user' },
        conversationalImpulse: {
          topic: 'The game session stopped because of an error',
          priority: 0.9,
        },
        silence: false,
      }
    case 'game-paused':
    case 'game-stopped':
      return {
        ...base,
        salience: 0.3,
        valence: 0,
        arousal: -0.2,
        novelty: 0.15,
        socialRelevance: 0.2,
        emotionHint: 'calm',
        embodimentHint: { intensity: 'subtle', gazeHint: 'user' },
        silence: true,
      }
  }
}

function keepsScreenGaze(type: GameSemanticEvent['type']): boolean {
  return !['game-paused', 'game-stopped', 'game-error', 'waiting-user'].includes(type)
}

function bounded(appraisal: ExperienceAppraisal): ExperienceAppraisal {
  return Object.freeze({
    ...appraisal,
    salience: unit(appraisal.salience),
    valence: mood(appraisal.valence),
    arousal: mood(appraisal.arousal),
    novelty: unit(appraisal.novelty),
    socialRelevance: unit(appraisal.socialRelevance),
    ...(appraisal.conversationalImpulse
      ? {
          conversationalImpulse: Object.freeze({
            topic: appraisal.conversationalImpulse.topic.slice(0, 300),
            priority: unit(appraisal.conversationalImpulse.priority),
          }),
        }
      : {}),
  })
}

function goalImportance(goal: PersistentGoal): number {
  const ownership = goal.owner === 'shared' ? 0.8 : goal.owner === 'user' ? 0.68 : 0.55
  const progressWeight = goal.measurable ? Math.min(0.1, unit(goal.progress) * 0.1) : 0
  return unit(ownership + progressWeight)
}

function isGoalEvent(
  event: ExperienceEvent,
): event is Extract<ExperienceEvent, { goalId: string }> {
  return (
    event.type === 'goal-progressed' ||
    event.type === 'goal-completed' ||
    event.type === 'goal-failed'
  )
}

function isFailureEvent(event: ExperienceEvent): boolean {
  return (
    event.type === 'action-failed' ||
    event.type === 'goal-failed' ||
    event.type === 'browser-blocked' ||
    (event.type === 'game-event' &&
      ['life-lost', 'death', 'stuck', 'game-over', 'game-error'].includes(event.gameEvent.type))
  )
}

function similarityKey(event: ExperienceEvent): string {
  return event.type === 'game-event' ? `${event.type}:${event.gameEvent.type}` : event.type
}

function eventIdentity(event: ExperienceEvent): string {
  return `${event.type}:${eventEntity(event)}:${event.at}`.slice(0, 160)
}

function eventEntity(event: ExperienceEvent): string {
  return 'turnId' in event
    ? event.turnId
    : 'taskId' in event
      ? event.taskId
      : 'actionId' in event
        ? event.actionId
        : 'goalId' in event
          ? event.goalId
          : 'gameEvent' in event
            ? event.gameEvent.sessionId
            : 'runtime' in event
              ? event.runtime
              : 'change' in event
                ? event.change
                : 'world'
}

function unit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function mood(value: number): number {
  return Math.max(-1, Math.min(1, value))
}
