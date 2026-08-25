import { randomUUID } from 'node:crypto'

import type {
  AliveRuntimeHealth,
  AliveSnapshot,
  AutonomySettings,
  BehaviorCommand,
  CreateGoalInput,
  CreateScheduledTaskInput,
  ExperienceEvent,
  FastBrainAttentionDecision,
  FastBrainAttentionInput,
  PersistentGoal,
  RendererWorldContextInput,
  ReviseGoalInput,
  ScheduledTask,
  UpdateGoalInput,
} from '../../shared/alive'
import type { LlmGateway } from '../llm'
import { mainLog } from '../logging/safeLogger'
import type { AliveStore } from './AliveStore'
import { AutonomyEnvelope } from './AutonomyEnvelope'
import { BehaviorRuntime } from './BehaviorRuntime'
import { ExperienceRuntime } from './ExperienceRuntime'
import { FastBrainRuntime } from './FastBrainRuntime'
import { SchedulerRuntime } from './SchedulerRuntime'
import { WorldContextRuntime } from './WorldContextRuntime'

export class AliveRuntime {
  private readonly world = new WorldContextRuntime()
  private readonly envelope = new AutonomyEnvelope()
  private readonly behavior = new BehaviorRuntime()
  private readonly experience: ExperienceRuntime
  private readonly fastBrain: FastBrainRuntime
  private readonly scheduler = new SchedulerRuntime()
  private readonly listeners = new Set<(snapshot: AliveSnapshot) => void>()
  private readonly behaviorListeners = new Set<(command: BehaviorCommand) => void>()
  private lastInitiativeAt: number | null = null
  private lastErrorCode: string | undefined

  constructor(
    private readonly store: AliveStore,
    llm: (selection: {
      providerId?: AutonomySettings['fastBrain']['providerId']
      model?: string
    }) => LlmGateway,
  ) {
    this.experience = new ExperienceRuntime(store, this.behavior)
    this.fastBrain = new FastBrainRuntime(llm)
  }

  start(): void {
    if (this.scheduler.isRunning()) return
    this.lastInitiativeAt =
      this.store
        .recentAudit()
        .find(
          (entry) =>
            entry.category === 'autonomy' &&
            entry.event === 'initiative' &&
            entry.outcome === 'executed',
        )?.at ?? null
    this.scheduler.start((now) => this.tick(now))
  }

  dispose(): void {
    this.scheduler.dispose()
    this.listeners.clear()
    this.behaviorListeners.clear()
    this.store.close()
  }

  onChanged(listener: (snapshot: AliveSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onBehavior(listener: (command: BehaviorCommand) => void): () => void {
    this.behaviorListeners.add(listener)
    return () => this.behaviorListeners.delete(listener)
  }

  snapshot(): AliveSnapshot {
    const settings = this.store.settings()
    const goals = this.store.goals()
    const tasks = this.store.tasks()
    const habits = this.store.habits()
    const world = this.world.snapshot(settings)
    return Object.freeze({
      settings,
      goals,
      tasks,
      habitSuggestions: habits,
      world,
      audit: this.store.recentAudit(),
      health: this.health(goals, tasks, habits),
    })
  }

  updateSettings(settings: AutonomySettings): AliveSnapshot {
    this.store.saveSettings(settings)
    this.store.audit('autonomy', 'settings_updated', 'success')
    return this.publish()
  }

  updateWorld(input: RendererWorldContextInput): void {
    this.world.updateRenderer(input)
  }

  reportExperience(event: ExperienceEvent): void {
    const settings = this.store.settings()
    const command = this.experience.observe(event, settings, this.world.snapshot(settings))
    if (command) {
      this.emitBehavior(command)
      this.store.audit('behavior', 'silence_reaction', 'executed')
    }
    this.publish()
  }

  createGoal(input: CreateGoalInput): AliveSnapshot {
    this.persistGoal(input)
    return this.publish()
  }

  createGoalFromCharacter(input: CreateGoalInput): PersistentGoal {
    const goal = this.persistGoal(input)
    this.publish()
    return goal
  }

  updateGoal(input: UpdateGoalInput): AliveSnapshot {
    this.reviseGoal(input)
    return this.publish()
  }

  reviseGoalFromCharacter(input: ReviseGoalInput): PersistentGoal {
    const goal = this.reviseGoal(input)
    this.publish()
    return goal
  }

  createTask(input: CreateScheduledTaskInput): AliveSnapshot {
    const task = this.store.createTask(input)
    this.store.audit('scheduler', 'task_created', 'success', task.id)
    return this.publish()
  }

  setTaskStatus(id: string, status: ScheduledTask['status']): AliveSnapshot {
    this.store.setTaskStatus(id, status)
    this.store.audit('scheduler', 'task_status_updated', 'success', id, status)
    return this.publish()
  }

  approveTaskRun(id: string): AliveSnapshot {
    const settings = this.store.settings()
    if (settings.globallySuspended) throw new Error('AUTONOMY_SUSPENDED')
    const task = this.store.tasks().find((candidate) => candidate.id === id)
    if (task?.status !== 'waiting_confirmation') throw new Error('TASK_NOT_CONFIRMABLE')
    this.executeTask(task, Date.now(), 'explicit-confirmation')
    return this.publish()
  }

  decideHabit(id: string, status: 'approved' | 'rejected'): AliveSnapshot {
    this.store.decideHabit(id, status)
    this.store.audit('habit', 'suggestion_decided', status, id)
    return this.publish()
  }

  async evaluateAttention(input: FastBrainAttentionInput): Promise<FastBrainAttentionDecision> {
    return this.fastBrain.evaluate(input, this.store.settings())
  }

  private async tick(now: number): Promise<void> {
    this.world.markSchedulerObserved(now)
    try {
      for (const task of this.store.tasks()) {
        if (task.status !== 'scheduled' || task.nextRunAt > now) continue
        const settings = this.store.settings()
        const decision = this.envelope.decide({
          task,
          settings,
          world: this.world.snapshot(settings, now),
          now,
          dailyInitiatives: this.store.dailyInitiativeCount(now),
          lastInitiativeAt: this.lastInitiativeAt,
        })
        if (decision.outcome === 'defer') {
          this.store.deferTask(task.id, decision.retryAt)
          this.store.audit('autonomy', 'initiative', 'deferred', task.id, decision.reason)
        } else if (decision.outcome === 'preview') {
          this.store.setTaskStatus(task.id, 'waiting_confirmation')
          this.store.audit('autonomy', 'initiative', 'previewed', task.id, decision.reason)
          this.emitBehavior({
            type: 'initiative',
            id: randomUUID(),
            at: now,
            taskId: task.id,
            title: task.title,
          })
        } else {
          this.executeTask(task, now, 'full-control')
        }
      }
      this.lastErrorCode = undefined
      this.publish()
    } catch (error) {
      this.lastErrorCode = error instanceof Error ? error.name : 'SCHEDULER_FAILURE'
      mainLog.error('[AliveRuntime] scheduler tick failed', { code: this.lastErrorCode })
    }
  }

  private executeTask(task: ScheduledTask, now: number, authority: string): void {
    const runKey = `${task.id}:${task.nextRunAt}`
    if (!this.store.claimTaskRun(task, runKey, now)) return
    this.lastInitiativeAt = now
    this.store.audit('autonomy', 'initiative', 'executed', task.id, authority)
    this.emitBehavior({
      type: 'initiative',
      id: randomUUID(),
      at: now,
      taskId: task.id,
      title: task.title,
    })
  }

  private health(
    goals: AliveSnapshot['goals'],
    tasks: AliveSnapshot['tasks'],
    habits: AliveSnapshot['habitSuggestions'],
  ): AliveRuntimeHealth {
    return Object.freeze({
      operational: !this.lastErrorCode,
      schedulerRunning: this.scheduler.isRunning(),
      databaseVersion: this.store.version(),
      lastTickAt: this.scheduler.lastTickAt(),
      pendingConfirmations: tasks.filter((task) => task.status === 'waiting_confirmation').length,
      activeGoals: goals.filter(
        (goal) => goal.status !== 'completed' && goal.status !== 'cancelled',
      ).length,
      scheduledTasks: tasks.filter((task) => task.status === 'scheduled').length,
      pendingHabitSuggestions: habits.filter((habit) => habit.status === 'pending').length,
      lastErrorCode: this.lastErrorCode,
    })
  }

  private publish(): AliveSnapshot {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
    return snapshot
  }

  private emitBehavior(command: BehaviorCommand): void {
    for (const listener of this.behaviorListeners) listener(command)
  }

  private persistGoal(input: CreateGoalInput): PersistentGoal {
    const goal = this.store.createGoal(input)
    this.store.audit('goal', 'created', 'success', goal.id, goal.owner)
    return goal
  }

  private reviseGoal(input: ReviseGoalInput): PersistentGoal {
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
