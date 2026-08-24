import {
  DESKTOP_WORKFLOW_SHELL_OUTPUT_MAX_CHARS,
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
    shell: evidence?.kind === 'shell' ? shellProjection(evidence) : undefined,
    presentationFacts: adapterResult?.presentationFacts,
  })
}

function boundedShellOutput(value: string): { text: string; truncated: boolean } {
  if (value.length <= DESKTOP_WORKFLOW_SHELL_OUTPUT_MAX_CHARS) {
    return { text: value, truncated: false }
  }
  return {
    text: value.slice(0, DESKTOP_WORKFLOW_SHELL_OUTPUT_MAX_CHARS),
    truncated: true,
  }
}

function shellProjection(evidence: Extract<DesktopWorkflowExecutionEvidence, { kind: 'shell' }>) {
  const stdout = boundedShellOutput(evidence.stdout)
  const stderr = boundedShellOutput(evidence.stderr)
  return {
    exitCode: evidence.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: evidence.truncated || stdout.truncated || stderr.truncated,
  }
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
    riskClass: evidence.riskClass ?? defaultBrowserRiskClass(evidence.operation),
    resultingUrl: evidence.after?.url,
    resultingTitle: evidence.after?.title,
    targetName: evidence.targetName,
    tabs: evidence.tabs,
  })
}

function defaultBrowserRiskClass(
  operation: Exclude<BrowserExecutionEvidence['operation'], 'workflow'>,
): BrowserActionExecution['riskClass'] {
  if (operation === 'observe' || operation === 'tabs') return 'read'
  if (operation === 'fill' || operation === 'select') return 'input'
  return 'navigation'
}
