import type {
  ActionAuthorization,
  ActionConfirmationRequest,
  DesktopAuthorityMode,
} from '../../shared/actions'
import { ActionError } from './ActionError'

export interface ActionPermissionGuardOptions {
  authorityMode: () => DesktopAuthorityMode
  requestConfirmation: (request: ActionConfirmationRequest) => Promise<'confirm' | 'cancel'>
  authorizeScope?: (
    scopeId: string,
    confirmation: ActionConfirmationRequest,
    requestConfirmation: (request: ActionConfirmationRequest) => Promise<'confirm' | 'cancel'>,
  ) => Promise<ActionAuthorization>
}

export class ActionPermissionGuard {
  constructor(private readonly options: ActionPermissionGuardOptions) {}

  async authorize(
    authority: 'implicit' | 'desktop-workflow',
    confirmation?: ActionConfirmationRequest,
    authorizationScopeId?: string,
    onConfirmationPending?: (request: ActionConfirmationRequest | null) => void,
  ): Promise<ActionAuthorization> {
    if (authority === 'implicit') return 'implicit'
    if (authorizationScopeId) {
      if (!confirmation || !this.options.authorizeScope) {
        throw new ActionError('ACTION_SCOPE_INVALID', 'The action authorization scope is invalid')
      }
      return this.options.authorizeScope(authorizationScopeId, confirmation, (request) =>
        this.requestDecision(request, onConfirmationPending),
      )
    }
    if (this.options.authorityMode() === 'full' && confirmation?.risk !== 'destructive') {
      return 'full'
    }
    if (!confirmation) {
      throw new ActionError(
        'ACTION_CONFIRMATION_MISSING',
        'The action requires a confirmation preview',
      )
    }
    const decision = await this.requestDecision(confirmation, onConfirmationPending)
    if (decision === 'cancel') {
      throw new ActionError(
        'ACTION_CANCELLED',
        'The action was cancelled before execution',
        'cancelled',
        true,
      )
    }
    return 'confirmed'
  }

  private async requestDecision(
    confirmation: ActionConfirmationRequest,
    onConfirmationPending?: (request: ActionConfirmationRequest | null) => void,
  ): Promise<'confirm' | 'cancel'> {
    onConfirmationPending?.(confirmation)
    try {
      return await this.options.requestConfirmation(confirmation)
    } finally {
      onConfirmationPending?.(null)
    }
  }
}
