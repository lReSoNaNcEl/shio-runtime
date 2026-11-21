import type {
  AliveRuntimeHealth,
  AliveSnapshot,
  AttentionCandidate,
  AttentionDecision,
  AutonomySettings,
  BehaviorCommand,
  ExperienceAppraisal,
  ExperienceEvent,
  FastBrainAttentionDecision,
  FastBrainAttentionInput,
  HabitSuggestion,
  RendererWorldContextInput,
} from '../../shared/alive'
import type { TurnAppraisal } from '../../shared/character-tools'
import type { RelationshipContext } from '../../shared/memory'
import type { LlmGateway } from '../llm'
import { observeMainPromise } from '../reliability/observePromise'
import type { AliveStore } from './AliveStore'
import { AttentionArbiter } from './AttentionArbiter'
import { AutonomyEnvelope } from './AutonomyEnvelope'
import { BehaviorRuntime, type ConversationCandidateDisposition } from './BehaviorRuntime'
import type { CompletedExperienceFact, ExperienceObservation } from './ExperienceRuntime'
import { ExperienceRuntime } from './ExperienceRuntime'
import { FastBrainRuntime } from './FastBrainRuntime'
import { MoodRuntime } from './MoodRuntime'
import {
  type ProactiveInitiativeApproval,
  ProactiveInitiativeGate,
} from './ProactiveInitiativeGate'
import type { SystemContextAdapter } from './SystemContextAdapter'
import { TurnAppraisalRegistry } from './TurnAppraisalRegistry'
import { type WorldContextProviders, WorldContextRuntime } from './WorldContextRuntime'

export interface AliveFacadeOptions {
  systemContextAdapter?: SystemContextAdapter
  worldContext?: WorldContextProviders
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
  private started = false
  private readonly world: WorldContextRuntime
  private readonly envelope = new AutonomyEnvelope()
  private readonly behavior = new BehaviorRuntime()
  private readonly experience: ExperienceRuntime
  private readonly attention: AttentionArbiter
  private readonly initiativeGate: ProactiveInitiativeGate
  private readonly listeners = new Set<(snapshot: AliveSnapshot) => void>()
  private readonly behaviorListeners = new Set<(command: BehaviorCommand) => void>()
  private readonly lifecycleController = new AbortController()
  private readonly attentionRequests = new Map<string, AbortController>()
  private previousAmbientWorld: AliveSnapshot['world'] | null = null
  private readonly turnAppraisals = new TurnAppraisalRegistry()
  private browserComputerUseScreenFocusActive = false

  constructor(
    private readonly store: AliveStore,
    llm: (selection: {
      providerId?: AutonomySettings['fastBrain']['providerId']
      model?: string
    }) => LlmGateway,
    private readonly options: AliveFacadeOptions = {},
  ) {
    this.world = new WorldContextRuntime(options.systemContextAdapter, options.worldContext)
    this.experience = new ExperienceRuntime(
      store,
      new MoodRuntime(store),
      (fact) => {
        options.proceduralMemory?.observeCompletedFact(fact)
        options.onCompletedExperienceFact?.(fact)
      },
      () => ({
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
  }

  start(): void {
    this.world.start()
    this.started = true
  }

  dispose(): void {
    this.initiativeGate.dispose()
    this.lifecycleController.abort(new DOMException('Alive Runtime disposed', 'AbortError'))
    for (const controller of this.attentionRequests.values()) {
      controller.abort(this.lifecycleController.signal.reason)
    }
    this.attentionRequests.clear()
    this.started = false
    this.world.dispose()
    this.listeners.clear()
    this.behaviorListeners.clear()
    this.turnAppraisals.clear()
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
    const habits = this.options.proceduralMemory?.habitSuggestions() ?? Object.freeze([])
    return Object.freeze({
      settings,
      habitSuggestions: habits,
      mood: this.experience.moodSnapshot(),
      lastExperience: this.experience.latest(),
      world: this.world.snapshot(settings),
      audit: this.store.recentAudit(),
      health: this.health(habits),
    })
  }

  updateSettings(settings: AutonomySettings): AliveSnapshot {
    this.store.saveSettings(settings)
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
    if (selected && this.emitBehavior(selected.command)) {
      this.behavior.notePresence(input.observedAt)
      this.publish()
      return
    }
    const idle = this.behavior.observeIdle({
      at: input.observedAt,
      settings,
      mood: this.experience.moodSnapshot(),
      conversationActive: current.conversationActive,
      audioActive: current.audioActive,
      browserComputerUseScreenFocusActive: this.browserComputerUseScreenFocusActive,
    })
    if (idle) this.emitIdlePresentation(idle)
  }

  /** Records the Character LLM's bounded nuance for an explicit user turn (Main only). */
  recordTurnAppraisal(turnId: string, appraisal: TurnAppraisal, at = Date.now()): void {
    this.turnAppraisals.record(turnId, appraisal, at)
  }

  reportExperience(event: ExperienceEvent): ExperienceReport {
    if (event.type === 'browser-computer-use-event') this.trackBrowserComputerUsePresence(event)
    const settings = this.store.settings()
    const world = this.world.snapshot(settings)
    const turnAppraisal =
      event.type === 'conversation-completed'
        ? this.turnAppraisals.take(event.turnId, event.at)
        : undefined
    const observation = this.experience.observe(event, turnAppraisal ? { turnAppraisal } : {})
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
          embodimentAllowed: !world.conversationActive && !world.audioActive,
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
            const currentWorld = this.world.snapshot(currentSettings)
            this.emitBehavior(
              this.behavior.decide({
                ...observation,
                settings: currentSettings,
                world: currentWorld,
                at: event.at,
                conversationAllowed: false,
                embodimentAllowed: !currentWorld.conversationActive && !currentWorld.audioActive,
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

  private health(habits: AliveSnapshot['habitSuggestions']): AliveRuntimeHealth {
    return Object.freeze({
      operational: this.started,
      databaseVersion: this.store.version(),
      pendingHabitSuggestions: habits.filter((habit) => habit.status === 'pending').length,
    })
  }

  private publish(): AliveSnapshot {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
    return snapshot
  }

  private emitBehavior(command: BehaviorCommand, authority?: ProactiveInitiativeApproval): boolean {
    if (command.intent.kind === 'none' && !command.embodimentPresence) return false
    if (command.intent.kind === 'conversation-candidate' && !authority) {
      this.store.audit('behavior', command.intent.kind, 'blocked', command.id, 'initiative-gate')
      return false
    }
    this.store.audit('behavior', command.intent.kind, 'selected', command.id, authority?.authority)
    const projection: BehaviorCommand = {
      ...command,
      initiativeDisposition:
        command.intent.kind === 'conversation-candidate' ? authority?.outcome : undefined,
    }
    for (const listener of this.behaviorListeners) listener(projection)
    return true
  }

  /** Bounded idle presentation is not an initiative or side effect; it is not audited
   * per activity, so the audit table does not grow every few seconds. */
  private emitIdlePresentation(command: BehaviorCommand): void {
    for (const listener of this.behaviorListeners) listener(command)
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
