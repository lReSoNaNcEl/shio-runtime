import type { ActionOutcome } from '../../shared/actions'

export class ActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome: Exclude<ActionOutcome, 'success'> = 'failure',
    readonly recoverable = false,
    readonly providerId?: string,
  ) {
    super(message)
    this.name = 'ActionError'
  }
}
