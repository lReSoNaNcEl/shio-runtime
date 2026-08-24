import type {
  ActionConfirmationRequest,
  ActionConfirmationResponse,
  AuthorityChangeRequest,
  AuthorityChangeResponse,
} from '../../shared/actions'

interface PendingDecision {
  resolve: (decision: 'confirm' | 'cancel') => void
  timeout: ReturnType<typeof setTimeout>
}

export class ActionConfirmationBroker {
  private readonly actionDecisions = new Map<string, PendingDecision>()
  private readonly authorityDecisions = new Map<string, PendingDecision>()
  private pendingAuthorityRequest: AuthorityChangeRequest | null = null

  constructor(
    private readonly publishAction: (request: ActionConfirmationRequest) => void,
    private readonly publishAuthority: (request: AuthorityChangeRequest) => void,
    private readonly timeoutMs = 120_000,
  ) {}

  requestAction(request: ActionConfirmationRequest): Promise<'confirm' | 'cancel'> {
    return this.request(this.actionDecisions, request.actionId, () => this.publishAction(request))
  }

  requestAuthority(request: AuthorityChangeRequest): Promise<'confirm' | 'cancel'> {
    this.pendingAuthorityRequest = request
    return this.request(this.authorityDecisions, request.requestId, () =>
      this.publishAuthority(request),
    )
  }

  pendingAuthority(): AuthorityChangeRequest | null {
    return this.pendingAuthorityRequest ? { ...this.pendingAuthorityRequest } : null
  }

  respondToAction(response: ActionConfirmationResponse): boolean {
    return this.respond(this.actionDecisions, response.actionId, response.decision)
  }

  cancelAction(actionId: string): boolean {
    return this.respond(this.actionDecisions, actionId, 'cancel')
  }

  respondToAuthority(response: AuthorityChangeResponse): boolean {
    const responded = this.respond(this.authorityDecisions, response.requestId, response.decision)
    if (responded && this.pendingAuthorityRequest?.requestId === response.requestId) {
      this.pendingAuthorityRequest = null
    }
    return responded
  }

  cancelAll(): void {
    for (const pending of [...this.actionDecisions.values(), ...this.authorityDecisions.values()]) {
      clearTimeout(pending.timeout)
      pending.resolve('cancel')
    }
    this.actionDecisions.clear()
    this.authorityDecisions.clear()
    this.pendingAuthorityRequest = null
  }

  private request(
    decisions: Map<string, PendingDecision>,
    id: string,
    publish: () => void,
  ): Promise<'confirm' | 'cancel'> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        decisions.delete(id)
        if (this.pendingAuthorityRequest?.requestId === id) this.pendingAuthorityRequest = null
        resolve('cancel')
      }, this.timeoutMs)
      decisions.set(id, { resolve, timeout })
      publish()
    })
  }

  private respond(
    decisions: Map<string, PendingDecision>,
    id: string,
    decision: 'confirm' | 'cancel',
  ): boolean {
    const pending = decisions.get(id)
    if (!pending) return false
    decisions.delete(id)
    clearTimeout(pending.timeout)
    pending.resolve(decision)
    return true
  }
}
