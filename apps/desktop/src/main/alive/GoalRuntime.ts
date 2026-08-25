import type {
  CreateGoalInput,
  PersistentGoal,
  ReviseGoalInput,
  UpdateGoalInput,
} from '../../shared/alive'
import type { AliveStore } from './AliveStore'

/** Owns durable goal lifecycle rules; it never executes Character tools or external actions. */
export class GoalRuntime {
  constructor(private readonly store: AliveStore) {}

  snapshot(): readonly PersistentGoal[] {
    return this.store.goals()
  }

  create(input: CreateGoalInput): PersistentGoal {
    const goal = this.store.createGoal(input)
    this.store.audit('goal', 'created', 'success', goal.id, goal.owner)
    return goal
  }

  update(input: UpdateGoalInput): PersistentGoal {
    return this.revise(input)
  }

  revise(input: ReviseGoalInput): PersistentGoal {
    const previous = this.store.goals().find((goal) => goal.id === input.id)
    if (!previous) throw new Error('GOAL_NOT_FOUND')
    if (
      input.progressPercent !== undefined &&
      (!Number.isInteger(input.progressPercent) ||
        input.progressPercent < 0 ||
        input.progressPercent > 100)
    ) {
      throw new Error('INVALID_GOAL_PROGRESS')
    }
    const progress =
      input.progressPercent === undefined
        ? input.status === 'completed'
          ? 1
          : previous.progress
        : Math.max(previous.progress, input.progressPercent / 100)
    const goal = this.store.updateGoal({
      ...input,
      progress,
      measurable: input.progressPercent === undefined ? input.measurable : true,
      status: input.progressPercent !== undefined && progress >= 1 ? 'completed' : input.status,
    })
    if (!goal) throw new Error('GOAL_NOT_FOUND')
    this.store.audit(
      'goal',
      input.progressPercent === undefined ? 'updated' : 'progress_updated',
      'success',
      goal.id,
      input.progressPercent === undefined ? goal.status : `${Math.round(goal.progress * 100)}%`,
    )
    if (goal.status === 'completed' && previous.status !== 'completed') {
      this.store.observeHabit('goal-follow-through', 'Доводить выбранные цели до завершения')
    }
    return goal
  }
}
