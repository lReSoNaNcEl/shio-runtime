import type {
  AliveRuntimeHealth,
  AliveSnapshot,
  AttentionCandidate,
  AttentionDecision,
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
import type { AliveStore } from './AliveStore'
import { AttentionArbiter } from './AttentionArbiter'
import { AutonomyEnvelope } from './AutonomyEnvelope'
import { BehaviorRuntime } from './BehaviorRuntime'
import { ExperienceRuntime } from './ExperienceRuntime'
import { FastBrainRuntime } from './FastBrainRuntime'
import { GoalRuntime } from './GoalRuntime'
import { MoodRuntime } from './MoodRuntime'
import { ScheduledTaskRuntime } from './ScheduledTaskRuntime'
import type { SystemContextAdapter } from './SystemContextAdapter'
import { type WorldContextProviders, WorldContextRuntime } from './WorldContextRuntime'

export interface AliveFacadeOptions {
  systemContextAdapter?: SystemContextAdapter
  worldContext?: Omit<WorldContextProviders, 'activeGoal'>
  onCompletedExperienceFact?: ConstructorParameters<typeof ExperienceRuntime>[3]
}

/** Narrow composition/IPC boundary. Domain decisions remain in the composed runtimes. */
export class AliveFacade {
  private readonly world: WorldContextRuntime
  private readonly envelope = new AutonomyEnvelope()
  private readonly behavior = new BehaviorRuntime()
  private readonly experience: ExperienceRuntime
  private readonly attention: AttentionArbiter
  private readonly goals: GoalRuntime
  private readonly scheduler: ScheduledTaskRuntime
  private readonly listeners = new Set<(snapshot: AliveSnapshot) => void>()
  private readonly behaviorListeners = new Set<(command: BehaviorCommand) => void>()

  constructor(
    private readonly store: AliveStore,
    llm: (selection: {
      providerId?: AutonomySettings['fastBrain']['providerId']
      model?: string
    }) => LlmGateway,
    options: AliveFacadeOptions = {},
  ) {
    this.goals = new GoalRuntime(store)
    this.world = new WorldContextRuntime(options.systemContextAdapter, {
      ...options.worldContext,
      activeGoal: () =>
        this.goals
          .snapshot()
          .find((goal) => goal.status !== 'completed' && goal.status !== 'cancelled') ?? null,
    })
    this.experience = new ExperienceRuntime(
      store,
      this.behavior,
      new MoodRuntime(store),
      options.onCompletedExperienceFact ?? (() => undefined),
    )
    this.attention = new AttentionArbiter(new FastBrainRuntime(llm))
    this.scheduler = new ScheduledTaskRuntime({
      store,
      envelope: this.envelope,
      world: this.world,
      onBehavior: (command) => this.emitBehavior(command),
      onChanged: () => this.publish(),
    })
  }

  start(): void {
    this.world.start()
    this.scheduler.start()
  }

  dispose(): void {
    this.world.dispose()
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
    const goals = this.goals.snapshot()
    const tasks = this.scheduler.snapshot()
    const habits = this.store.habits()
    return Object.freeze({
      settings,
      goals,
      tasks,
      habitSuggestions: habits,
      mood: this.experience.moodSnapshot(),
      lastExperience: this.experience.latest(),
      world: this.world.snapshot(settings),
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
    const observation = this.experience.observe(event, settings, this.world.snapshot(settings))
    if (observation.behavior.intent.kind !== 'none') this.emitBehavior(observation.behavior)
    this.publish()
  }

  createGoal(input: CreateGoalInput): AliveSnapshot {
    this.goals.create(input)
    return this.publish()
  }

  createGoalFromCharacter(input: CreateGoalInput): PersistentGoal {
    const goal = this.goals.create(input)
    this.publish()
    return goal
  }

  updateGoal(input: UpdateGoalInput): AliveSnapshot {
    this.goals.update(input)
    return this.publish()
  }

  reviseGoalFromCharacter(input: ReviseGoalInput): PersistentGoal {
    const goal = this.goals.revise(input)
    this.publish()
    return goal
  }

  createTask(input: CreateScheduledTaskInput): AliveSnapshot {
    this.scheduler.create(input)
    return this.publish()
  }

  setTaskStatus(id: string, status: ScheduledTask['status']): AliveSnapshot {
    this.scheduler.setStatus(id, status)
    return this.publish()
  }

  approveTaskRun(id: string): AliveSnapshot {
    this.scheduler.approve(id, this.store.settings())
    return this.publish()
  }

  decideHabit(id: string, status: 'approved' | 'rejected'): AliveSnapshot {
    this.store.decideHabit(id, status)
    this.store.audit('habit', 'suggestion_decided', status, id)
    return this.publish()
  }

  evaluateAttention(input: FastBrainAttentionInput): Promise<FastBrainAttentionDecision> {
    return this.attention.evaluateLegacy(input, this.store.settings())
  }

  arbitrateAttention(candidates: readonly AttentionCandidate[]): Promise<AttentionDecision> {
    return this.attention.decide(candidates, this.store.settings(), {
      busy: this.world.snapshot(this.store.settings()).conversationActive,
    })
  }

  private health(
    goals: AliveSnapshot['goals'],
    tasks: AliveSnapshot['tasks'],
    habits: AliveSnapshot['habitSuggestions'],
  ): AliveRuntimeHealth {
    const lastErrorCode = this.scheduler.errorCode()
    return Object.freeze({
      operational: !lastErrorCode,
      schedulerRunning: this.scheduler.isRunning(),
      databaseVersion: this.store.version(),
      lastTickAt: this.scheduler.lastTickAt(),
      pendingConfirmations: tasks.filter((task) => task.status === 'waiting_confirmation').length,
      activeGoals: goals.filter(
        (goal) => goal.status !== 'completed' && goal.status !== 'cancelled',
      ).length,
      scheduledTasks: tasks.filter((task) => task.status === 'scheduled').length,
      pendingHabitSuggestions: habits.filter((habit) => habit.status === 'pending').length,
      lastErrorCode,
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
}
