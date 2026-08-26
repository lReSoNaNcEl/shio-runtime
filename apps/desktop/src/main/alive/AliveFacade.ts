import type {
  AliveRuntimeHealth,
  AliveSnapshot,
  AttentionCandidate,
  AttentionDecision,
  AutonomyScope,
  AutonomySettings,
  BehaviorCommand,
  CreateGoalInput,
  CreateScheduledTaskInput,
  ExperienceAppraisal,
  ExperienceEvent,
  FastBrainAttentionDecision,
  FastBrainAttentionInput,
  GoalExecutionBudget,
  GoalExecutionState,
  GoalStepOutcome,
  GoalWakeCondition,
  GoalWakeEvent,
  HabitSuggestion,
  PersistentGoal,
  RendererWorldContextInput,
  ReviseGoalInput,
  ScheduledTask,
  UpdateGoalInput,
} from '../../shared/alive'
import type { RelationshipContext } from '../../shared/memory'
import type { LlmGateway } from '../llm'
import { observeMainPromise } from '../reliability/observePromise'
import type { AliveStore } from './AliveStore'
import { AttentionArbiter } from './AttentionArbiter'
import { AutonomyEnvelope } from './AutonomyEnvelope'
import { AutonomyScopeRuntime, type ScopedActionProposal } from './AutonomyScopeRuntime'
import { BehaviorRuntime, type ConversationCandidateDisposition } from './BehaviorRuntime'
import { EventWatchService } from './EventWatchService'
import type { CompletedExperienceFact, ExperienceObservation } from './ExperienceRuntime'
import { ExperienceRuntime } from './ExperienceRuntime'
import { FastBrainRuntime } from './FastBrainRuntime'
import { GoalRuntime } from './GoalRuntime'
import { MoodRuntime } from './MoodRuntime'
import {
  type ProactiveInitiativeApproval,
  ProactiveInitiativeGate,
} from './ProactiveInitiativeGate'
import { ScheduledTaskRuntime } from './ScheduledTaskRuntime'
import type { SystemContextAdapter } from './SystemContextAdapter'
import { type WorldContextProviders, WorldContextRuntime } from './WorldContextRuntime'

export interface AliveFacadeOptions {
  systemContextAdapter?: SystemContextAdapter
  worldContext?: Omit<WorldContextProviders, 'activeGoal'>
  onCompletedExperienceFact?: ConstructorParameters<typeof ExperienceRuntime>[2]
  experienceContext?: () => RelationshipContext
  proceduralMemory?: {
    observeCompletedFact(fact: CompletedExperienceFact): void
    habitSuggestions(): readonly HabitSuggestion[]
    decideHabit(id: string, status: 'approved' | 'rejected'): void
  }
}

export interface ExperienceReport extends ExperienceObservation {
  conversationCandidate: ConversationCandidateDisposition
}

/** Narrow composition/IPC boundary. Domain decisions remain in the composed runtimes. */
export class AliveFacade {
  private readonly world: WorldContextRuntime
  private readonly envelope = new AutonomyEnvelope()
  private readonly behavior = new BehaviorRuntime()
  private readonly experience: ExperienceRuntime
  private readonly attention: AttentionArbiter
  private readonly initiativeGate: ProactiveInitiativeGate
  private readonly goals: GoalRuntime
  private readonly watches: EventWatchService
  private readonly scopes: AutonomyScopeRuntime
  private readonly scheduler: ScheduledTaskRuntime
  private readonly listeners = new Set<(snapshot: AliveSnapshot) => void>()
  private readonly behaviorListeners = new Set<(command: BehaviorCommand) => void>()
  private readonly lifecycleController = new AbortController()
  private readonly attentionRequests = new Map<string, AbortController>()
  private previousAmbientWorld: AliveSnapshot['world'] | null = null
  private browserComputerUseScreenFocusActive = false

  constructor(
    private readonly store: AliveStore,
    llm: (selection: {
      providerId?: AutonomySettings['fastBrain']['providerId']
      model?: string
    }) => LlmGateway,
    private readonly options: AliveFacadeOptions = {},
  ) {
    this.goals = new GoalRuntime(store)
    this.watches = new EventWatchService(store, this.goals)
    this.scopes = new AutonomyScopeRuntime(store)
    this.world = new WorldContextRuntime(options.systemContextAdapter, {
      ...options.worldContext,
      activeGoal: () =>
        this.goals
          .snapshot()
          .find((goal) => goal.status !== 'completed' && goal.status !== 'cancelled') ?? null,
    })
    this.experience = new ExperienceRuntime(
      store,
      new MoodRuntime(store),
      (fact) => {
        options.proceduralMemory?.observeCompletedFact(fact)
        options.onCompletedExperienceFact?.(fact)
      },
      (event) => ({
        goal:
          'goalId' in event
            ? this.goals.snapshot().find((goal) => goal.id === event.goalId)
            : undefined,
        relationship: options.experienceContext?.(),
      }),
    )
    this.attention = new AttentionArbiter(new FastBrainRuntime(llm))
    this.initiativeGate = new ProactiveInitiativeGate({
      store,
      envelope: this.envelope,
      attention: this.attention,
      settings: () => this.store.settings(),
      world: (settings, now) => this.world.snapshot(settings, now),
    })
    this.scheduler = new ScheduledTaskRuntime({
      store,
      initiativeGate: this.initiativeGate,
      markSchedulerObserved: (now) => this.world.markSchedulerObserved(now),
      onBehavior: (command, authority) => this.emitBehavior(command, authority),
      onChanged: () => this.publish(),
      onTick: (now) => {
        const awakened = this.watches.tick(now)
        if (awakened.length > 0) this.emitGoalAttention(now)
      },
    })
  }

  start(): void {
    this.goals.restore(this.store.settings())
    this.world.start()
    this.scheduler.start()
  }

  dispose(): void {
    this.initiativeGate.dispose()
    this.lifecycleController.abort(new DOMException('Alive Runtime disposed', 'AbortError'))
    for (const controller of this.attentionRequests.values()) {
      controller.abort(this.lifecycleController.signal.reason)
    }
    this.attentionRequests.clear()
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
    const habits = this.options.proceduralMemory?.habitSuggestions() ?? Object.freeze([])
    return Object.freeze({
      settings,
      goals,
      goalExecutions: this.goals.executionSnapshot(),
      goalWatches: this.watches.snapshot(),
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
    if (settings.globallySuspended || settings.mode === 'off') {
      this.goals.pauseAutonomousWork(settings.globallySuspended ? 'global-suspend' : 'mode-off')
    }
    this.store.audit('autonomy', 'settings_updated', 'success')
    return this.publish()
  }

  updateWorld(input: RendererWorldContextInput): void {
    this.world.updateRenderer(input)
    const settings = this.store.settings()
    const current = this.world.snapshot(settings, input.observedAt)
    const previous = this.previousAmbientWorld
    this.previousAmbientWorld = current
    if (!previous) return
    const selected = this.behavior.observeAmbientPresence({
      previous,
      current,
      settings,
      mood: this.experience.moodSnapshot(),
      browserComputerUseScreenFocusActive: this.browserComputerUseScreenFocusActive,
      at: input.observedAt,
    })
    if (selected && this.emitBehavior(selected.command)) this.publish()
  }

  reportExperience(event: ExperienceEvent): ExperienceReport {
    if (event.type === 'browser-computer-use-event') this.trackBrowserComputerUsePresence(event)
    const settings = this.store.settings()
    const world = this.world.snapshot(settings)
    const observation = this.experience.observe(event)
    const impulse = observation.appraisal.conversationalImpulse
    const conversationCandidate: ConversationCandidateDisposition = !impulse
      ? 'not-requested'
      : world.conversationActive || world.audioActive
        ? 'suppressed-busy'
        : this.behavior.assessConversationCandidate({
            ...observation,
            settings,
            world,
            at: event.at,
            conversationAllowed: true,
          })
    const report = { ...observation, conversationCandidate }
    if (!impulse) {
      this.emitBehavior(
        this.behavior.decide({
          ...observation,
          settings,
          world,
          at: event.at,
          conversationAllowed: false,
        }),
      )
      this.publish()
      return report
    }
    const origin = experienceOrigin(event)
    observeMainPromise(
      this.initiativeGate
        .submit(
          {
            origin,
            entityId: observation.appraisal.eventId,
            candidates: [experienceAttentionCandidate(event, observation.appraisal)],
          },
          (approval) => {
            const currentSettings = this.store.settings()
            const command = this.behavior.decide({
              ...observation,
              settings: currentSettings,
              world: this.world.snapshot(currentSettings),
              at: event.at,
              conversationAllowed: true,
            })
            if (command.intent.kind !== 'conversation-candidate') return false
            return this.emitBehavior(command, approval)
          },
        )
        .then((decision) => {
          if (!['admit', 'preview'].includes(decision.outcome)) {
            const currentSettings = this.store.settings()
            this.emitBehavior(
              this.behavior.decide({
                ...observation,
                settings: currentSettings,
                world: this.world.snapshot(currentSettings),
                at: event.at,
                conversationAllowed: false,
              }),
            )
          }
          this.publish()
        }),
      `gate ${origin} initiative`,
    )
    this.publish()
    return report
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
    if (!this.options.proceduralMemory) throw new Error('PROCEDURAL_MEMORY_UNAVAILABLE')
    this.options.proceduralMemory.decideHabit(id, status)
    this.store.audit('habit', 'suggestion_decided', status, id)
    return this.publish()
  }

  evaluateAttention(input: FastBrainAttentionInput): Promise<FastBrainAttentionDecision> {
    this.lifecycleController.signal.throwIfAborted()
    this.attentionRequests
      .get(input.utteranceId)
      ?.abort(new DOMException('Attention request superseded', 'AbortError'))
    const controller = new AbortController()
    const abortForLifecycle = (): void => controller.abort(this.lifecycleController.signal.reason)
    this.lifecycleController.signal.addEventListener('abort', abortForLifecycle, { once: true })
    this.attentionRequests.set(input.utteranceId, controller)
    return this.attention
      .evaluateLegacy(input, this.store.settings(), { signal: controller.signal })
      .finally(() => {
        this.lifecycleController.signal.removeEventListener('abort', abortForLifecycle)
        if (this.attentionRequests.get(input.utteranceId) === controller) {
          this.attentionRequests.delete(input.utteranceId)
        }
      })
  }

  cancelAttention(utteranceId: string): boolean {
    const controller = this.attentionRequests.get(utteranceId)
    if (!controller) return false
    controller.abort(new DOMException('Attention request cancelled', 'AbortError'))
    this.attentionRequests.delete(utteranceId)
    return true
  }

  arbitrateAttention(candidates: readonly AttentionCandidate[]): Promise<AttentionDecision> {
    const settings = this.store.settings()
    const world = this.world.snapshot(settings)
    return this.attention.decide(candidates, settings, {
      busy: world.conversationActive || world.audioActive,
      signal: this.lifecycleController.signal,
    })
  }

  planGoal(
    goalId: string,
    steps: readonly string[],
    budget?: Partial<GoalExecutionBudget>,
  ): GoalExecutionState {
    const state = this.goals.plan(goalId, steps, { budget })
    this.publish()
    return state
  }

  admitGoalStep(goalId: string): GoalExecutionState {
    const state = this.goals.admitStep(goalId)
    this.publish()
    return state
  }

  recordGoalActionResult(input: {
    goalId: string
    actionId: string
    verified: boolean
    outcome?: GoalStepOutcome
    summary?: string
  }): GoalExecutionState {
    const state = this.goals.recordVerifiedResult(input)
    this.publish()
    return state
  }

  waitForGoalEvent(goalId: string, condition: GoalWakeCondition): GoalExecutionState {
    const state = this.goals.waitForEvent(goalId, condition)
    this.publish()
    return state
  }

  observeGoalEvent(event: GoalWakeEvent): void {
    if (this.watches.observe(event).length > 0) {
      this.emitGoalAttention(event.at)
      this.publish()
    }
  }

  approveAutonomyScope(
    input: Omit<AutonomyScope, 'id' | 'actionsUsed' | 'approvedAt'>,
  ): AutonomyScope {
    return this.scopes.approve(input, 'explicit-user-approval')
  }

  consumeAutonomyScope(goalId: string, proposal: ScopedActionProposal): boolean {
    return this.scopes.authorizeAndConsume(goalId, proposal)
  }

  emergencyStop(): AliveSnapshot {
    this.goals.pauseAutonomousWork('emergency-stop')
    return this.publish()
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

  private emitBehavior(
    command: BehaviorCommand,
    authority?: ProactiveInitiativeApproval | 'explicit-user',
  ): boolean {
    if (command.intent.kind === 'none' && !command.embodimentPresence) return false
    if (['conversation-candidate', 'goal-suggestion'].includes(command.intent.kind) && !authority) {
      this.store.audit('behavior', command.intent.kind, 'blocked', command.id, 'initiative-gate')
      return false
    }
    this.store.audit(
      'behavior',
      command.intent.kind,
      'selected',
      command.id,
      authority === 'explicit-user' ? authority : authority?.authority,
    )
    for (const listener of this.behaviorListeners) listener(command)
    return true
  }

  private emitGoalAttention(now: number): void {
    const candidates = this.goals.attentionCandidates(now)
    if (candidates.length === 0) return
    observeMainPromise(
      this.initiativeGate.submit(
        {
          origin: 'goal',
          entityId: 'awakened-goal',
          candidates,
        },
        (approval) => {
          if (!approval.attention.candidateId) return false
          const goalId = approval.attention.candidateId.split(':')[1]
          const goal = this.goals.snapshot().find((candidate) => candidate.id === goalId)
          if (!goal) return false
          return this.emitBehavior(
            this.behavior.proactiveInitiative(
              `goal-awakened:${goal.id}:${now}`,
              goal.nextStep || goal.title,
              0.78,
              now,
            ),
            approval,
          )
        },
      ),
      'arbitrate awakened goal attention',
    )
  }

  private trackBrowserComputerUsePresence(
    event: Extract<ExperienceEvent, { type: 'browser-computer-use-event' }>,
  ): void {
    this.browserComputerUseScreenFocusActive = [
      'started',
      'progress',
      'notable-observation',
    ].includes(event.phase)
  }
}

function experienceOrigin(event: ExperienceEvent): 'experience' | 'world' {
  return ['meaningful-world-context-changed', 'user-returned'].includes(event.type)
    ? 'world'
    : 'experience'
}

function experienceAttentionCandidate(
  event: ExperienceEvent,
  appraisal: ExperienceAppraisal,
): AttentionCandidate {
  const impulse = appraisal.conversationalImpulse
  if (!impulse) throw new Error('EXPERIENCE_HAS_NO_CONVERSATIONAL_IMPULSE')
  return Object.freeze({
    id: `${experienceOrigin(event)}:${appraisal.eventId}`.slice(0, 220),
    source: experienceOrigin(event),
    summary: impulse.topic.slice(0, 300),
    salience: appraisal.salience,
    novelty: appraisal.novelty,
    urgency: impulse.priority,
    socialRelevance: appraisal.socialRelevance,
    interruptibility: impulse.priority >= 0.9 ? 'urgent' : 'when-idle',
    createdAt: event.at,
    expiresAt: event.at + 5 * 60_000,
  })
}
