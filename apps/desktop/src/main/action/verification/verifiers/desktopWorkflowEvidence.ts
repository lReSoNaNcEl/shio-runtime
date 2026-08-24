import {
  type DesktopWorkflowAdapterResult,
  type DesktopWorkflowExecutionEvidence,
  isDesktopWorkflowAdapterResult,
} from '../../../desktop-control/executionEvidence'
import type { ActionExecutionResult } from '../contracts'

export function desktopWorkflowEvidence(
  execution: ActionExecutionResult,
): DesktopWorkflowExecutionEvidence | undefined {
  if (isDesktopWorkflowAdapterResult(execution.output)) return execution.output.evidence
  const errorEvidence = execution.evidence
  if (!errorEvidence || typeof errorEvidence !== 'object') return undefined
  const candidate = errorEvidence as Partial<DesktopWorkflowAdapterResult>
  if (candidate.evidence && typeof candidate.evidence === 'object') return candidate.evidence
  if ('kind' in errorEvidence) return errorEvidence as DesktopWorkflowExecutionEvidence
  return undefined
}
