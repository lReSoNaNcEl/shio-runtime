import {
  type DesktopWorkflowActionResult,
  type DesktopWorkflowExecution,
  desktopWorkflowActionResultSchema,
  desktopWorkflowExecutionSchema,
} from '../../shared/actions'
import {
  type BrowserActionExecution,
  browserActionExecutionSchema,
} from '../../shared/desktop-control'
import type {
  BrowserExecutionEvidence,
  DesktopWorkflowAdapterResult,
  DesktopWorkflowExecutionEvidence,
} from '../desktop-control'
import type { ActionResult } from './types'

export function toDesktopWorkflowActionResult(
  action: ActionResult<DesktopWorkflowAdapterResult>,
): DesktopWorkflowActionResult {
  return desktopWorkflowActionResultSchema.parse({
    actionId: action.actionId,
    tool: 'desktop.workflow',
    outcome: action.status,
    authorization: action.authorization,
    execution: action.execution ? buildExecutionProjection(action) : undefined,
    errorCode: action.errorCode,
    error: action.error,
  })
}

function buildExecutionProjection(
  action: ActionResult<DesktopWorkflowAdapterResult>,
): DesktopWorkflowExecution {
  const adapterResult = action.execution?.output ?? action.result
  const evidence = adapterResult?.evidence ?? executionErrorEvidence(action.execution?.evidence)
  const verification = action.verification?.status ?? 'failed'
  return desktopWorkflowExecutionSchema.parse({
    runtimeCompleted:
      action.execution?.status === 'success' && adapterResult?.runtimeCompleted === true,
    reportedOutcome: adapterResult?.reportedOutcome,
    verification,
    verificationReason: action.verification?.reasonCode ?? action.execution?.errorCode,
    verificationSummary: action.verification?.summary,
    browser: evidence?.kind === 'browser' ? browserProjection(evidence, action) : undefined,
  })
}

function executionErrorEvidence(value: unknown): DesktopWorkflowExecutionEvidence | undefined {
  if (!value || typeof value !== 'object' || !('kind' in value)) return undefined
  const kind = value.kind
  return kind === 'browser' || kind === 'shell'
    ? (value as DesktopWorkflowExecutionEvidence)
    : undefined
}

function browserProjection(
  evidence: BrowserExecutionEvidence,
  action: ActionResult<DesktopWorkflowAdapterResult>,
): BrowserActionExecution | undefined {
  if (evidence.operation === 'workflow') return undefined
  const executionStatus = action.execution?.status
  return browserActionExecutionSchema.parse({
    kind: 'browser',
    operation: evidence.operation,
    status:
      executionStatus === 'success'
        ? 'success'
        : executionStatus === 'cancelled'
          ? 'cancelled'
          : 'failed',
    verification: action.verification?.status,
    resultingUrl: evidence.after?.url,
    resultingTitle: evidence.after?.title,
    targetName: evidence.targetName,
  })
}
