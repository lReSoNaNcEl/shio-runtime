import type {
  ActionAuthorization,
  ActionConfirmationRequest,
  DesktopAuthorityMode,
} from '../../shared/actions'
import { ActionError } from './ActionError'

export interface ActionPermissionGuardOptions {
  authorityMode: () => DesktopAuthorityMode
  requestConfirmation: (request: ActionConfirmationRequest) => Promise<'confirm' | 'cancel'>
}

export class ActionPermissionGuard {
  constructor(private readonly options: ActionPermissionGuardOptions) {}

  async authorize(
    authority: 'implicit' | 'desktop-workflow',
    confirmation?: ActionConfirmationRequest,
  ): Promise<ActionAuthorization> {
    if (authority === 'implicit') return 'implicit'
    if (this.options.authorityMode() === 'full') return 'full'
    if (!confirmation) {
      throw new ActionError(
        'ACTION_CONFIRMATION_MISSING',
        'The action requires a confirmation preview',
      )
    }
    const decision = await this.options.requestConfirmation(confirmation)
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
}
