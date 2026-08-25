import type {
  AutonomySettings,
  BehaviorCommand,
  ExperienceAppraisal,
  ExperienceEvent,
  MoodState,
  WorldContextSnapshot,
} from '../../shared/alive'
import type { AliveStore } from './AliveStore'
import type { BehaviorRuntime } from './BehaviorRuntime'
import type { MoodRuntime } from './MoodRuntime'

export interface CompletedExperienceFact {
  eventId: string
  kind: 'task-completed' | 'goal-completed' | 'action-verified'
  entityId: string
  at: number
}

export interface ExperienceObservation {
  appraisal: ExperienceAppraisal
  mood: MoodState
  behavior: BehaviorCommand
}

export class ExperienceRuntime {
  private lastAppraisal: ExperienceAppraisal | undefined

  constructor(
    private readonly store: AliveStore,
    private readonly behavior: BehaviorRuntime,
    private readonly mood: MoodRuntime,
    private readonly onCompletedFact: (fact: CompletedExperienceFact) => void,
  ) {}

  observe(
    event: ExperienceEvent,
    settings: AutonomySettings,
    world: WorldContextSnapshot,
  ): ExperienceObservation {
    const appraisal = appraise(event)
    const mood = this.mood.apply(appraisal, event.at)
    const behavior = this.behavior.decide({ appraisal, mood, settings, world, at: event.at })
    this.lastAppraisal = appraisal
    this.store.audit('experience', event.type, appraisal.silence ? 'silence' : 'appraised')
    if (behavior.intent.kind !== 'none') {
      this.store.audit('behavior', behavior.intent.kind, 'selected', behavior.id)
    }
    const completed = completedFact(event, appraisal.eventId)
    if (completed) this.onCompletedFact(completed)
    return { appraisal, mood, behavior }
  }

  moodSnapshot(now = Date.now()): MoodState {
    return this.mood.snapshot(now)
  }

  latest(): ExperienceAppraisal | undefined {
    return this.lastAppraisal
  }
}

function appraise(event: ExperienceEvent): ExperienceAppraisal {
  const eventId = event.eventId?.slice(0, 160) || eventIdentity(event)
  const base = { eventId, memoryCandidate: undefined }
  switch (event.type) {
    case 'conversation-completed':
      return bounded({
        ...base,
        salience: 0.25,
        valence: 0.25,
        arousal: -0.1,
        novelty: 0.1,
        socialRelevance: 0.7,
        emotionHint: 'warm',
        silence: true,
      })
    case 'conversation-interrupted':
      return bounded({
        ...base,
        salience: 0.65,
        valence: -0.25,
        arousal: 0.45,
        novelty: 0.3,
        socialRelevance: 0.8,
        emotionHint: 'surprised',
        embodimentHint: { intensity: 'subtle', gazeHint: 'user' },
        silence: true,
      })
    case 'task-completed':
      return bounded({
        ...base,
        salience: 0.35,
        valence: 0.4,
        arousal: 0.1,
        novelty: 0.15,
        socialRelevance: 0.35,
        emotionHint: 'happy',
        silence: true,
      })
    case 'silence-threshold':
      return bounded({
        ...base,
        salience: 0.2,
        valence: 0,
        arousal: -0.25,
        novelty: 0.1,
        socialRelevance: 0.25,
        embodimentHint: { intensity: 'subtle', gestureHint: 'think', gazeHint: 'screen' },
        silence: true,
      })
    case 'action-verified':
      return bounded({
        ...base,
        salience: 0.4,
        valence: 0.45,
        arousal: 0.15,
        novelty: event.novelty ?? 0.2,
        socialRelevance: 0.3,
        emotionHint: 'happy',
        silence: true,
      })
    case 'action-failed':
      return bounded({
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
      })
    case 'permission-denied':
      return bounded({
        ...base,
        salience: 0.7,
        valence: -0.2,
        arousal: 0.3,
        novelty: 0.35,
        socialRelevance: 0.75,
        emotionHint: 'calm',
        silence: true,
      })
    case 'browser-blocked':
      return bounded({
        ...base,
        salience: 0.72,
        valence: -0.45,
        arousal: 0.5,
        novelty: 0.55,
        socialRelevance: 0.35,
        emotionHint: 'surprised',
        conversationalImpulse: { topic: 'Browser workflow is blocked', priority: 0.7 },
        silence: false,
      })
    case 'browser-recovered':
    case 'runtime-recovered':
      return bounded({
        ...base,
        salience: 0.45,
        valence: 0.35,
        arousal: 0.2,
        novelty: 0.35,
        socialRelevance: 0.25,
        emotionHint: 'calm',
        silence: true,
      })
    case 'goal-progressed':
      return bounded({
        ...base,
        salience: 0.48,
        valence: 0.4,
        arousal: 0.2,
        novelty: 0.25,
        socialRelevance: 0.45,
        emotionHint: 'happy',
        silence: true,
      })
    case 'goal-completed':
      return bounded({
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
      })
    case 'goal-failed':
      return bounded({
        ...base,
        salience: 0.88,
        valence: -0.7,
        arousal: 0.6,
        novelty: 0.65,
        socialRelevance: 0.65,
        emotionHint: 'sad',
        conversationalImpulse: { topic: 'A goal needs replanning', priority: 0.82 },
        silence: false,
      })
    case 'scheduled-event-due':
      return bounded({
        ...base,
        salience: 0.65,
        valence: 0.1,
        arousal: 0.35,
        novelty: 0.2,
        socialRelevance: 0.55,
        conversationalImpulse: { topic: 'A scheduled event is due', priority: 0.75 },
        silence: false,
      })
    case 'user-returned':
      return bounded({
        ...base,
        salience: 0.55,
        valence: 0.3,
        arousal: 0.25,
        novelty: Math.min(1, event.idleMs / 3_600_000),
        socialRelevance: 0.75,
        emotionHint: 'warm',
        embodimentHint: { intensity: 'subtle', gazeHint: 'user' },
        silence: true,
      })
    case 'meaningful-world-context-changed':
      return bounded({
        ...base,
        salience: 0.32,
        valence: 0,
        arousal: 0.1,
        novelty: 0.45,
        socialRelevance: 0.15,
        emotionHint: 'calm',
        silence: true,
      })
  }
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

function eventIdentity(event: ExperienceEvent): string {
  const entity =
    'turnId' in event
      ? event.turnId
      : 'taskId' in event
        ? event.taskId
        : 'actionId' in event
          ? event.actionId
          : 'goalId' in event
            ? event.goalId
            : 'runtime' in event
              ? event.runtime
              : 'change' in event
                ? event.change
                : 'world'
  return `${event.type}:${entity}:${event.at}`.slice(0, 160)
}

function completedFact(event: ExperienceEvent, eventId: string): CompletedExperienceFact | null {
  if (event.type === 'task-completed' && event.verified !== false) {
    return { eventId, kind: event.type, entityId: event.taskId, at: event.at }
  }
  if (event.type === 'goal-completed') {
    return { eventId, kind: event.type, entityId: event.goalId, at: event.at }
  }
  if (event.type === 'action-verified') {
    return { eventId, kind: event.type, entityId: event.actionId, at: event.at }
  }
  return null
}

function unit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function mood(value: number): number {
  return Math.max(-1, Math.min(1, value))
}
