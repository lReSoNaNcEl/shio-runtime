import type { ActionOutcome } from '../../shared/actions'
import type { ActionResult } from './types'

export function isVerifiedSuccess(result: ActionResult): boolean {
  return (
    result.execution?.status === 'success' &&
    (result.verification?.status === 'verified' || result.verification?.status === 'not-required')
  )
}

export function getActionCompletionStatus(result: ActionResult): ActionOutcome {
  if (result.execution?.status === 'timeout') return 'timeout'
  if (result.execution?.status === 'cancelled') return 'cancelled'
  if (!isVerifiedSuccess(result)) return 'failure'
  return 'success'
}
