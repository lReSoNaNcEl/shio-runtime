import type {
  AttentionCandidate,
  AttentionDecision,
  AutonomySettings,
  WorldContextSnapshot,
} from '../../shared/alive'
import type { AliveStore } from './AliveStore'
import type { AttentionArbiter } from './AttentionArbiter'
import type { AutonomyDecision, AutonomyEnvelope } from './AutonomyEnvelope'

export type ProactiveInitiativeOrigin = 'experience' | 'scheduler' | 'goal' | 'world' | 'behavior'

export interface ProactiveInitiativeRequest {
  origin: ProactiveInitiativeOrigin
  entityId: string
  candidates: readonly AttentionCandidate[]
}

export type ProactiveInitiativeApproval = Readonly<{
  outcome: 'admit' | 'preview'
  authority: 'full-control' | 'suggest-mode' | 'confirmation-required'
  attention: AttentionDecision
}>

export type ProactiveInitiativeDecision =
  | Readonly<{
      outcome: 'defer'
      reason: Extract<AutonomyDecision, { outcome: 'defer' }>['reason']
      retryAt: number
    }>
  | Readonly<{
      outcome: 'ignore' | 'observe'
      reason: string
      attention?: AttentionDecision
    }>
  | ProactiveInitiativeApproval

interface ProactiveInitiativeGateOptions {
  store: AliveStore
  envelope: AutonomyEnvelope
  attention: AttentionArbiter
  settings(): AutonomySettings
  world(settings: AutonomySettings, now: number): WorldContextSnapshot
  now?(): number
}

/** Canonical policy and attention boundary for every autonomous conversation initiative. */
export class ProactiveInitiativeGate {
  private evaluationTail: Promise<void> = Promise.resolve()
  private lastInitiativeAt: number | null
  private disposed = false
  private readonly lifecycleController = new AbortController()

  constructor(private readonly options: ProactiveInitiativeGateOptions) {
    this.lastInitiativeAt = options.store.lastInitiativeAt()
  }

  submit(
    request: ProactiveInitiativeRequest,
    deliver: (approval: ProactiveInitiativeApproval) => boolean | Promise<boolean>,
  ): Promise<ProactiveInitiativeDecision> {
    if (this.disposed) return Promise.resolve({ outcome: 'ignore', reason: 'gate-disposed' })
    const evaluation = this.evaluationTail.then(
      () => this.evaluate(request, deliver),
      () => this.evaluate(request, deliver),
    )
    this.evaluationTail = evaluation.then(
      () => undefined,
      () => undefined,
    )
    return evaluation
  }

  dispose(): void {
    this.disposed = true
    this.lifecycleController.abort(
      new DOMException('Proactive Initiative Gate disposed', 'AbortError'),
    )
  }

  private async evaluate(
    request: ProactiveInitiativeRequest,
    deliver: (approval: ProactiveInitiativeApproval) => boolean | Promise<boolean>,
  ): Promise<ProactiveInitiativeDecision> {
    if (this.disposed) return { outcome: 'ignore', reason: 'gate-disposed' }
    const now = this.options.now?.() ?? Date.now()
    const settings = this.options.settings()
    const world = this.options.world(settings, now)
    const policy = this.options.envelope.decide({
      settings,
      world,
      now,
      dailyInitiatives: this.options.store.dailyInitiativeCount(now),
      lastInitiativeAt: this.lastInitiativeAt,
    })
    if (policy.outcome === 'defer') {
      this.audit(request, 'deferred', policy.reason)
      return policy
    }

    let attention: AttentionDecision
    try {
      attention = await this.options.attention.decide(request.candidates, settings, {
        busy: world.conversationActive || world.audioActive,
        now,
        signal: this.lifecycleController.signal,
      })
    } catch (error) {
      if (this.lifecycleController.signal.aborted) {
        return { outcome: 'ignore', reason: 'gate-disposed' }
      }
      throw error
    }
    if (this.disposed) return { outcome: 'ignore', reason: 'gate-disposed', attention }
    if (attention.disposition !== 'admit') {
      this.audit(request, attention.disposition, attention.reason)
      return {
        outcome: attention.disposition,
        reason: attention.reason,
        attention,
      }
    }

    const approval: ProactiveInitiativeApproval = Object.freeze({
      outcome: policy.outcome === 'execute' ? 'admit' : 'preview',
      authority:
        policy.outcome === 'execute'
          ? 'full-control'
          : policy.reason === 'suggest_mode'
            ? 'suggest-mode'
            : 'confirmation-required',
      attention,
    })
    const delivered = await deliver(approval)
    if (this.disposed) return { outcome: 'ignore', reason: 'gate-disposed', attention }
    if (!delivered) {
      this.audit(request, 'ignored', 'delivery-rejected')
      return { outcome: 'ignore', reason: 'delivery-rejected', attention }
    }

    this.lastInitiativeAt = now
    this.audit(request, approval.outcome === 'admit' ? 'executed' : 'previewed', approval.authority)
    return approval
  }

  private audit(request: ProactiveInitiativeRequest, outcome: string, reason: string): void {
    this.options.store.audit(
      'autonomy',
      'initiative',
      outcome,
      request.entityId,
      `${request.origin}:${reason}`.slice(0, 240),
    )
  }
}
