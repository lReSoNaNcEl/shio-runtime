import type {
  AttentionCandidate,
  AutonomySettings,
  CreateGoalInput,
  GoalExecutionBudget,
  GoalExecutionState,
  GoalStepOutcome,
  GoalWakeCondition,
  PersistentGoal,
  ReviseGoalInput,
  UpdateGoalInput,
} from '../../shared/alive'
import type { AliveStore } from './AliveStore'

const DEFAULT_BUDGET: GoalExecutionBudget = Object.freeze({
  maxSteps: 12,
  maxToolCalls: 24,
  maxElapsedMs: 4 * 60 * 60_000,
  maxFailures: 3,
})

/** Durable goal lifecycle/checkpoint owner. It never executes tools or concrete adapters. */
export class GoalRuntime {
  constructor(private readonly store: AliveStore) {}

  snapshot(): readonly PersistentGoal[] {
    return this.store.goals()
  }

  executionSnapshot(): readonly GoalExecutionState[] {
    return this.store.goalExecutions()
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
    const previous = this.requireGoal(input.id)
    if (
      input.progressPercent !== undefined &&
      (!Number.isInteger(input.progressPercent) ||
        input.progressPercent < 0 ||
        input.progressPercent > 100)
    ) {
      throw new Error('INVALID_GOAL_PROGRESS')
    }
    if ((input.progressPercent === undefined) !== (input.progressBasis === undefined)) {
      throw new Error('GOAL_PROGRESS_BASIS_REQUIRED')
    }
    const requestedProgress =
      input.progressPercent === undefined ? undefined : input.progressPercent / 100
    const correction = input.progressBasis === 'explicit-user-correction'
    const progress =
      requestedProgress === undefined
        ? input.status === 'completed'
          ? 1
          : previous.progress
        : correction
          ? requestedProgress
          : Math.max(previous.progress, requestedProgress)
    if (input.status === 'completed' && progress < 1) {
      throw new Error('GOAL_PROGRESS_STATUS_CONFLICT')
    }
    const correctedBackward = correction && progress < previous.progress
    const status =
      progress >= 1
        ? 'completed'
        : previous.status === 'completed' && correctedBackward
          ? (input.status ?? 'active')
          : input.status
    const { progressBasis: _progressBasis, progressPercent: _progressPercent, ...update } = input
    const goal = this.store.updateGoal({
      ...update,
      progress,
      measurable: input.progressPercent === undefined ? input.measurable : true,
      status,
    })
    if (!goal) throw new Error('GOAL_NOT_FOUND')
    this.store.audit(
      'goal',
      input.progressPercent === undefined
        ? 'updated'
        : correctedBackward
          ? 'progress_corrected'
          : 'progress_updated',
      'success',
      goal.id,
      input.progressPercent === undefined
        ? goal.status
        : `${input.progressBasis}:${Math.round(goal.progress * 100)}%`,
    )
    if (correctedBackward) this.resetExecution(goal.id, goal.status, Date.now())
    if (goal.status === 'completed') this.finishExecution(goal.id, 'completed', Date.now())
    if (goal.status === 'cancelled' || goal.status === 'paused') {
      this.finishExecution(goal.id, 'paused', Date.now())
    }
    if (goal.status === 'active' && previous.status === 'paused') {
      const execution = this.store.goalExecutions().find((state) => state.goalId === goal.id)
      if (execution?.phase === 'paused') {
        this.store.saveGoalExecution({ ...execution, phase: 'idle', updatedAt: Date.now() })
      }
    }
    return goal
  }

  plan(
    goalId: string,
    steps: readonly string[],
    options: { budget?: Partial<GoalExecutionBudget>; now?: number } = {},
  ): GoalExecutionState {
    this.requireGoal(goalId)
    const now = options.now ?? Date.now()
    const budget = normalizeBudget(options.budget)
    const plannedSteps = steps.map((step) => step.trim().slice(0, 300)).filter(Boolean)
    if (plannedSteps.length === 0) throw new Error('GOAL_PLAN_EMPTY')
    if (plannedSteps.length > budget.maxSteps) throw new Error('GOAL_STEP_BUDGET_EXCEEDED')
    const state: GoalExecutionState = Object.freeze({
      goalId,
      phase: 'planning',
      currentStep: plannedSteps[0],
      plannedSteps: Object.freeze(plannedSteps),
      completedSteps: Object.freeze([]),
      attempts: 0,
      toolCalls: 0,
      failures: 0,
      startedAt: now,
      lastProgressAt: now,
      actionBudget: budget,
      updatedAt: now,
    })
    this.store.saveGoalExecution(state)
    this.store.audit('goal', 'plan_created', 'success', goalId, `${plannedSteps.length} steps`)
    return state
  }

  attentionCandidates(now = Date.now()): readonly AttentionCandidate[] {
    const goals = new Map(this.snapshot().map((goal) => [goal.id, goal]))
    return Object.freeze(
      this.executionSnapshot()
        .filter((state) => ['idle', 'planning'].includes(state.phase))
        .filter((state) => !budgetExceeded(state, now))
        .flatMap((state) => {
          const goal = goals.get(state.goalId)
          if (goal?.status !== 'active') return []
          return [
            Object.freeze({
              id: `goal:${goal.id}:${state.updatedAt}`,
              source: 'goal' as const,
              summary: state.currentStep || goal.nextStep || goal.title,
              salience: 0.58,
              novelty: state.attempts === 0 ? 0.55 : 0.25,
              urgency: 0.35,
              socialRelevance: goal.owner === 'shared' ? 0.7 : 0.45,
              interruptibility: 'when-idle' as const,
              createdAt: state.updatedAt,
              expiresAt: now + 5 * 60_000,
            }),
          ]
        }),
    )
  }

  admitStep(goalId: string, now = Date.now()): GoalExecutionState {
    const current = this.requireExecution(goalId)
    this.enforceBudget(current, now)
    if (!['idle', 'planning'].includes(current.phase)) throw new Error('GOAL_NOT_ADMISSIBLE')
    const currentStep = nextStep(current)
    if (!currentStep) return this.finishExecution(goalId, 'completed', now)
    return this.save({
      ...current,
      phase: 'running',
      currentStep,
      attempts: current.attempts + 1,
      startedAt: current.startedAt ?? now,
      updatedAt: now,
    })
  }

  noteToolCall(goalId: string, now = Date.now()): GoalExecutionState {
    const current = this.requireExecution(goalId)
    const next = this.save({ ...current, toolCalls: current.toolCalls + 1, updatedAt: now })
    this.enforceBudget(next, now)
    return this.requireExecution(goalId)
  }

  awaitVerification(goalId: string, now = Date.now()): GoalExecutionState {
    const current = this.requireExecution(goalId)
    if (current.phase !== 'running') throw new Error('GOAL_STEP_NOT_RUNNING')
    return this.save({ ...current, phase: 'verifying', updatedAt: now })
  }

  recordVerifiedResult(input: {
    goalId: string
    actionId: string
    verified: boolean
    outcome?: GoalStepOutcome
    summary?: string
    at?: number
  }): GoalExecutionState {
    const now = input.at ?? Date.now()
    const current = this.requireExecution(input.goalId)
    if (!['running', 'verifying'].includes(current.phase)) throw new Error('GOAL_STEP_NOT_RUNNING')
    if (!input.verified) {
      const failures = current.failures + 1
      const phase = failures >= current.actionBudget.maxFailures ? 'failed' : 'planning'
      const failed = this.save({ ...current, phase, failures, updatedAt: now })
      this.store.audit('goal', 'verified_step', 'failed', input.goalId, input.actionId)
      if (phase === 'failed') this.store.updateGoal({ id: input.goalId, status: 'paused' })
      return failed
    }
    const outcome = validateStepOutcome(input.actionId, input.outcome)
    const step = current.currentStep ?? nextStep(current)
    if (!step) return this.finishExecution(input.goalId, 'completed', now)
    const currentStepOutcome = mergeStepOutcomes(current.currentStepOutcome, outcome)
    if (!currentStepOutcome.stepCompleted) {
      const pending = this.save({
        ...current,
        phase: 'planning',
        currentStep: step,
        currentStepOutcome,
        lastProgressAt: now,
        updatedAt: now,
      })
      this.store.audit(
        'goal',
        'verified_step',
        currentStepOutcome.expectationSatisfied ? 'expectation-satisfied' : 'partial',
        input.goalId,
        input.actionId,
      )
      return pending
    }
    const completedSteps = Object.freeze([...current.completedSteps, step])
    const done = completedSteps.length >= current.plannedSteps.length
    const next = this.save({
      ...current,
      phase: done ? 'completed' : 'planning',
      currentStep: done ? undefined : current.plannedSteps[completedSteps.length],
      completedSteps,
      currentStepOutcome: undefined,
      lastProgressAt: now,
      updatedAt: now,
    })
    const progress = Math.max(
      this.requireGoal(input.goalId).progress,
      completedSteps.length / current.plannedSteps.length,
    )
    this.store.updateGoal({
      id: input.goalId,
      progress,
      measurable: true,
      lastNote: input.summary?.slice(0, 1_000),
      status: done ? 'completed' : 'active',
    })
    this.store.audit('goal', 'verified_step', 'success', input.goalId, input.actionId)
    return next
  }

  waitForEvent(goalId: string, condition: GoalWakeCondition, now = Date.now()): GoalExecutionState {
    const current = this.requireExecution(goalId)
    this.store.createGoalWatch(goalId, condition, now)
    this.store.updateGoal({ id: goalId, status: 'waiting_external' })
    return this.save({ ...current, phase: 'waiting-event', updatedAt: now })
  }

  wake(goalId: string, now = Date.now()): GoalExecutionState {
    const current = this.requireExecution(goalId)
    if (current.phase !== 'waiting-event') return current
    this.store.updateGoal({ id: goalId, status: 'active' })
    this.store.audit('goal', 'watch_satisfied', 'success', goalId)
    return this.save({ ...current, phase: 'planning', lastProgressAt: now, updatedAt: now })
  }

  restore(settings: AutonomySettings, now = Date.now()): void {
    for (const state of this.executionSnapshot()) {
      if (!['running', 'verifying'].includes(state.phase)) continue
      const resume =
        settings.mode === 'full' &&
        !settings.globallySuspended &&
        !settings.privacyMode &&
        !budgetExceeded(state, now)
      this.save({ ...state, phase: resume ? 'planning' : 'paused', updatedAt: now })
      this.store.audit('goal', 'restored', resume ? 'resumable' : 'paused', state.goalId)
    }
  }

  pauseAutonomousWork(reason: string, now = Date.now()): void {
    const goals = new Map(this.snapshot().map((goal) => [goal.id, goal]))
    for (const state of this.executionSnapshot()) {
      const goal = goals.get(state.goalId)
      if (goal?.status === 'completed') {
        if (state.phase !== 'completed') {
          this.save({ ...state, phase: 'completed', updatedAt: now })
        }
        continue
      }
      if (goal?.status === 'cancelled') continue
      if (['completed', 'failed', 'paused'].includes(state.phase)) continue
      this.save({ ...state, phase: 'paused', updatedAt: now })
      this.store.updateGoal({ id: state.goalId, status: 'paused' })
      this.store.audit('goal', 'autonomous_pause', 'paused', state.goalId, reason)
    }
  }

  private enforceBudget(state: GoalExecutionState, now: number): void {
    if (!budgetExceeded(state, now)) return
    this.finishExecution(state.goalId, 'failed', now)
    this.store.updateGoal({ id: state.goalId, status: 'paused' })
    throw new Error('GOAL_EXECUTION_BUDGET_EXCEEDED')
  }

  private finishExecution(
    goalId: string,
    phase: 'paused' | 'completed' | 'failed',
    now: number,
  ): GoalExecutionState {
    const current = this.requireExecution(goalId)
    return this.save({
      ...current,
      phase,
      currentStep: undefined,
      currentStepOutcome: phase === 'completed' ? undefined : current.currentStepOutcome,
      lastProgressAt: phase === 'completed' ? now : current.lastProgressAt,
      updatedAt: now,
    })
  }

  private resetExecution(goalId: string, status: PersistentGoal['status'], now: number): void {
    const current = this.requireExecution(goalId)
    this.save({
      ...current,
      phase: status === 'paused' ? 'paused' : 'idle',
      currentStep: undefined,
      plannedSteps: Object.freeze([]),
      completedSteps: Object.freeze([]),
      currentStepOutcome: undefined,
      attempts: 0,
      toolCalls: 0,
      failures: 0,
      startedAt: undefined,
      lastProgressAt: now,
      updatedAt: now,
    })
    this.store.audit('goal', 'execution_reset', 'success', goalId, 'progress-correction')
  }

  private requireGoal(id: string): PersistentGoal {
    const goal = this.snapshot().find((candidate) => candidate.id === id)
    if (!goal) throw new Error('GOAL_NOT_FOUND')
    return goal
  }

  private requireExecution(goalId: string): GoalExecutionState {
    const state = this.executionSnapshot().find((candidate) => candidate.goalId === goalId)
    if (!state) throw new Error('GOAL_EXECUTION_NOT_FOUND')
    return state
  }

  private save(state: GoalExecutionState): GoalExecutionState {
    const frozen = Object.freeze({
      ...state,
      plannedSteps: Object.freeze([...state.plannedSteps]),
      completedSteps: Object.freeze([...state.completedSteps]),
      currentStepOutcome: state.currentStepOutcome
        ? Object.freeze({
            ...state.currentStepOutcome,
            verifiedActionIds: Object.freeze([...state.currentStepOutcome.verifiedActionIds]),
          })
        : undefined,
      actionBudget: Object.freeze({ ...state.actionBudget }),
    })
    this.store.saveGoalExecution(frozen)
    return frozen
  }
}

function normalizeBudget(input?: Partial<GoalExecutionBudget>): GoalExecutionBudget {
  return Object.freeze({
    maxSteps: boundedInteger(input?.maxSteps, DEFAULT_BUDGET.maxSteps, 1, 32),
    maxToolCalls: boundedInteger(input?.maxToolCalls, DEFAULT_BUDGET.maxToolCalls, 1, 64),
    maxElapsedMs: boundedInteger(
      input?.maxElapsedMs,
      DEFAULT_BUDGET.maxElapsedMs,
      60_000,
      24 * 60 * 60_000,
    ),
    maxFailures: boundedInteger(input?.maxFailures, DEFAULT_BUDGET.maxFailures, 1, 8),
  })
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}

function budgetExceeded(state: GoalExecutionState, now: number): boolean {
  return (
    state.plannedSteps.length > state.actionBudget.maxSteps ||
    state.toolCalls > state.actionBudget.maxToolCalls ||
    state.failures >= state.actionBudget.maxFailures ||
    (state.startedAt !== undefined && now - state.startedAt > state.actionBudget.maxElapsedMs)
  )
}

function nextStep(state: GoalExecutionState): string | undefined {
  return state.plannedSteps[state.completedSteps.length] ?? state.currentStep
}

function validateStepOutcome(
  actionId: string,
  outcome: GoalStepOutcome | undefined,
): GoalStepOutcome {
  if (!outcome) throw new Error('GOAL_STEP_OUTCOME_REQUIRED')
  if (outcome.stepCompleted && !outcome.expectationSatisfied) {
    throw new Error('GOAL_STEP_OUTCOME_INVALID')
  }
  if (
    outcome.verifiedActionIds.length === 0 ||
    outcome.verifiedActionIds.length > 64 ||
    outcome.verifiedActionIds.some(
      (id) => typeof id !== 'string' || id.trim().length === 0 || id.length > 200,
    ) ||
    !outcome.verifiedActionIds.includes(actionId)
  ) {
    throw new Error('GOAL_STEP_VERIFIED_ACTIONS_INVALID')
  }
  return Object.freeze({
    verifiedActionIds: Object.freeze([...new Set(outcome.verifiedActionIds)]),
    expectationSatisfied: outcome.expectationSatisfied,
    stepCompleted: outcome.stepCompleted,
  })
}

function mergeStepOutcomes(
  previous: GoalStepOutcome | undefined,
  current: GoalStepOutcome,
): GoalStepOutcome {
  return Object.freeze({
    verifiedActionIds: Object.freeze([
      ...new Set([...(previous?.verifiedActionIds ?? []), ...current.verifiedActionIds]),
    ]),
    expectationSatisfied: current.expectationSatisfied,
    stepCompleted: current.stepCompleted,
  })
}
