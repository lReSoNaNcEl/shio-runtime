import {
  type DesktopWorkflowActionResult,
  type DesktopWorkflowExecution,
  desktopWorkflowActionResultSchema,
  desktopWorkflowExecutionSchema,
} from '../../shared/actions'
import type { ActionResult } from './types'

export function toDesktopWorkflowActionResult(
  action: ActionResult<DesktopWorkflowExecution>,
): DesktopWorkflowActionResult {
  return desktopWorkflowActionResultSchema.parse({
    actionId: action.actionId,
    tool: 'desktop.workflow',
    outcome: action.status,
    authorization: action.authorization,
    execution:
      action.status === 'success' ? desktopWorkflowExecutionSchema.parse(action.result) : undefined,
    errorCode: action.errorCode,
    error: action.error,
  })
}
