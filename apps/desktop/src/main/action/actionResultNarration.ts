import type { DesktopWorkflowActionResult } from '../../shared/actions'

export function buildActionResultNarrationContext(result: DesktopWorkflowActionResult) {
  return {
    outcome: result.outcome,
    authorization: result.authorization,
    execution: result.execution
      ? {
          runtimeCompleted: result.execution.runtimeCompleted,
          shell: result.execution.shell,
          presentationFacts: result.execution.presentationFacts,
          verification: {
            status: result.execution.verification,
            reason: result.execution.verificationReason,
            summary: result.execution.verificationSummary,
          },
          browser: result.execution.browser,
        }
      : undefined,
    errorCode: result.errorCode,
    error: result.error,
  }
}
