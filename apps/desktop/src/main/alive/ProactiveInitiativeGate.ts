import type {
  AttentionCandidate,
  AttentionDecision,
  AutonomySettings,
  WorldContextSnapshot,
} from '../../shared/alive'
import type { AliveStore } from './AliveStore'
import type { AttentionArbiter } from './AttentionArbiter'
import type { AutonomyDecision, AutonomyEnvelope } from './AutonomyEnvelope'

export type ProactiveInitiativeOrigin = 'experience' | 'world' | 'behavior' | 'watch-together'

export interface ProactiveInitiativeRequest {
  origin: ProactiveInitiativeOrigin
  entityId: string
  candidates: readonly AttentionCandidate[]
}

export type ProactiveInitiativeApproval = Readonly<{
  outcome: 'admit' | 'preview'
  authority: 'watch-session' | 'full-control' | 'suggest-mode' | 'confirmation-required'
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
  private disposed = false

  constructor(private readonly options: ProactiveInitiativeGateOptions) {}

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

  watchAllowedNow(): boolean {
    if (this.disposed) return false
    return this.policy('watch-together').decision.outcome === 'execute'
  }

  dispose(): void {
    this.disposed = true
  }

  private policy(origin: ProactiveInitiativeOrigin) {
    const now = this.options.now?.() ?? Date.now()
    const settings = this.options.settings()
    const world = this.options.world(settings, now)
    const confirmedWatchSession = origin === 'watch-together'
    const decision = this.options.envelope.decide({
      settings,
      world,
      now,
      confirmedWatchSession,
    })
    return { now, world, decision }
  }

  private async evaluate(
    request: ProactiveInitiativeRequest,
    deliver: (approval: ProactiveInitiativeApproval) => boolean | Promise<boolean>,
  ): Promise<ProactiveInitiativeDecision> {
    if (this.disposed) return { outcome: 'ignore', reason: 'gate-disposed' }
    const { now, world, decision: policy } = this.policy(request.origin)
    if (policy.outcome === 'defer') {
      this.audit(request, 'deferred', policy.reason)
      return policy
    }

    const attention = this.options.attention.decide(request.candidates, {
      busy: world.conversationActive || world.audioActive,
      now,
    })
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
          ? request.origin === 'watch-together'
            ? 'watch-session'
            : 'full-control'
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
