import type { ExperienceAppraisal, ExperienceEvent, MoodState } from '../../shared/alive'
import type { AliveStore } from './AliveStore'
import { ExperiencePolicy, type ExperiencePolicyContext } from './ExperiencePolicy'
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
}

export type ExperienceContextProvider = (
  event: ExperienceEvent,
) => Omit<ExperiencePolicyContext, 'currentMood'>

export class ExperienceRuntime {
  private lastAppraisal: ExperienceAppraisal | undefined

  constructor(
    private readonly store: AliveStore,
    private readonly mood: MoodRuntime,
    private readonly onCompletedFact: (fact: CompletedExperienceFact) => void,
    private readonly contextProvider: ExperienceContextProvider = () => ({}),
    private readonly policy = new ExperiencePolicy(),
  ) {}

  observe(event: ExperienceEvent): ExperienceObservation {
    const currentMood = this.mood.snapshot(event.at)
    const appraisal = this.policy.appraise(event, {
      ...this.context(event),
      currentMood,
    })
    const mood = this.mood.apply(appraisal, event.at)
    this.lastAppraisal = appraisal
    this.store.audit('experience', event.type, appraisal.silence ? 'silence' : 'appraised')
    const completed = completedFact(event, appraisal.eventId)
    if (completed) this.onCompletedFact(completed)
    return { appraisal, mood }
  }

  moodSnapshot(now = Date.now()): MoodState {
    return this.mood.snapshot(now)
  }

  latest(): ExperienceAppraisal | undefined {
    return this.lastAppraisal
  }

  private context(event: ExperienceEvent): Omit<ExperiencePolicyContext, 'currentMood'> {
    try {
      return this.contextProvider(event)
    } catch (error) {
      this.store.audit(
        'experience',
        'context_projection',
        'degraded',
        undefined,
        error instanceof Error ? error.name : 'unknown',
      )
      return {}
    }
  }
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
