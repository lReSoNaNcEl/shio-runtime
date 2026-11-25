import type {
  AliveAuditEntry,
  AliveRuntimeHealth,
  AliveSnapshot,
  AttentionCandidate,
  AutonomySettings,
  BehaviorCommand,
  ExperienceAppraisal,
  ExperienceEvent,
  RendererWorldContextInput,
  RunningApplicationsDiagnostic,
  SpeechAttentionDecision,
  SpeechAttentionInput,
} from '../../shared/alive'
import type { TurnAppraisal } from '../../shared/character-tools'
import type { RelationshipContext } from '../../shared/memory'
import { observeMainPromise } from '../reliability/observePromise'
import type { AliveStore } from './AliveStore'
import { AttentionArbiter } from './AttentionArbiter'
import { AutonomyEnvelope } from './AutonomyEnvelope'
import { BehaviorRuntime, type ConversationCandidateDisposition } from './BehaviorRuntime'
import type { ExperienceObservation } from './ExperienceRuntime'
import { ExperienceRuntime } from './ExperienceRuntime'
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
  experienceContext?: () => RelationshipContext
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
  private readonly attention = new AttentionArbiter()
  private readonly initiativeGate: ProactiveInitiativeGate
  private readonly listeners = new Set<(snapshot: AliveSnapshot) => void>()
  private readonly behaviorListeners = new Set<(command: BehaviorCommand) => void>()
  private previousAmbientWorld: AliveSnapshot['world'] | null = null
  private readonly turnAppraisals = new TurnAppraisalRegistry()
  private browserComputerUseScreenFocusActive = false

  constructor(
    private readonly store: AliveStore,
    options: AliveFacadeOptions = {},
  ) {
    this.world = new WorldContextRuntime(options.systemContextAdapter, options.worldContext)
    this.experience = new ExperienceRuntime(store, new MoodRuntime(store), () => ({
      relationship: options.experienceContext?.(),
    }))
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
    return Object.freeze({
      settings,
      mood: this.experience.moodSnapshot(),
      lastExperience: this.experience.latest(),
      world: this.world.snapshot(settings),
      health: this.health(),
    })
  }

  recentAudit(): readonly AliveAuditEntry[] {
    return this.store.recentAudit()
  }

  async getRunningApplications(): Promise<RunningApplicationsDiagnostic> {
    if (!this.started) return { status: 'unavailable' }
    if (this.store.settings().privacyMode) return { status: 'private' }
    const applications = await this.world.listRunningApplications()
    if (!this.started) return { status: 'unavailable' }
    if (this.store.settings().privacyMode) return { status: 'private' }
    return applications ? { status: 'available', applications } : { status: 'unavailable' }
  }

  canCommentOnPlayback() {
    return this.initiativeGate.watchAllowedNow()
  }

  async admitWatchMoment(expiresAt: number, current: () => boolean): Promise<boolean> {
    const now = Date.now()
    const id = crypto.randomUUID()
    const result = await this.initiativeGate.submit(
      {
        origin: 'watch-together',
        entityId: id,
        candidates: [
          {
            id,
            source: 'experience',
            summary: 'Shared viewing moment',
            salience: 0.8,
            novelty: 0.8,
            urgency: 0.45,
            socialRelevance: 0.8,
            interruptibility: 'when-idle',
            createdAt: now,
            expiresAt,
          },
        ],
      },
      current,
    )
    return result.outcome === 'admit'
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
      const command = this.behavior.decide({
        ...observation,
        settings,
        world,
        at: event.at,
        conversationAllowed: false,
        embodimentAllowed: !world.conversationActive && !world.audioActive,
      })
      if (event.type === 'watch-screen-moment') {
        command.watchReaction = { sessionId: event.sessionId, expiresAt: event.expiresAt }
        command.holdMs = 1500
      }
      this.emitBehavior(command)
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

  evaluateAttention(input: SpeechAttentionInput): SpeechAttentionDecision {
    return this.attention.evaluateSpeech(input)
  }

  private health(): AliveRuntimeHealth {
    return Object.freeze({
      operational: this.started,
      databaseVersion: this.store.version(),
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
