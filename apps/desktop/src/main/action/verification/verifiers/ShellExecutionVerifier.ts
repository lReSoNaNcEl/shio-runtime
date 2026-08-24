import type { DesktopWorkflowRequest } from '../../../../shared/actions'
import type {
  ActionVerificationRequest,
  ActionVerificationResult,
  ActionVerifier,
} from '../contracts'
import { desktopWorkflowEvidence } from './desktopWorkflowEvidence'

export class ShellExecutionVerifier implements ActionVerifier {
  readonly id = 'shell-execution'

  async verify(request: ActionVerificationRequest): Promise<ActionVerificationResult> {
    const payload = request.payload as DesktopWorkflowRequest
    const evidence = desktopWorkflowEvidence(request.execution)
    if (evidence?.kind !== 'shell') {
      return result('failed', 'shell-evidence-missing', 'Shell execution evidence is unavailable.')
    }
    if (evidence.aborted || request.execution.status === 'cancelled') {
      return result('failed', 'shell-execution-cancelled', 'The shell execution was cancelled.')
    }
    if (evidence.timedOut || request.execution.status === 'timeout') {
      return result('failed', 'shell-execution-timeout', 'The shell execution timed out.')
    }
    if (evidence.exitCode !== 0) {
      return result('failed', 'shell-exit-nonzero', 'The shell process reported a failure.')
    }
    if (payload.risk === 'destructive') {
      return {
        status: 'unverified',
        evidence: [shellEvidence(evidence.durationMs, evidence.truncated)],
        reasonCode: 'shell-post-state-verifier-required',
        summary:
          'The shell process reported success, but a mutating command requires a typed post-state verifier.',
        observedAt: Date.now(),
        durationMs: 0,
      }
    }
    if (!evidence.stdout.trim()) {
      return {
        status: 'unverified',
        evidence: [shellEvidence(evidence.durationMs, evidence.truncated)],
        reasonCode: 'shell-output-empty',
        summary: 'The shell process reported success but returned no observable result.',
        observedAt: Date.now(),
        durationMs: 0,
      }
    }
    return {
      status: 'verified',
      evidence: [shellEvidence(evidence.durationMs, evidence.truncated)],
      summary: 'The informational command completed successfully and returned bounded output.',
      observedAt: Date.now(),
      durationMs: 0,
    }
  }
}

function shellEvidence(durationMs: number, truncated: boolean) {
  return {
    kind: 'shell-execution',
    summary: 'The shell process completed with exit code zero and returned bounded evidence.',
    details: { durationMs, outputTruncated: truncated },
  }
}

function result(
  status: 'failed' | 'unverified',
  reasonCode: string,
  summary: string,
): ActionVerificationResult {
  return {
    status,
    evidence: [],
    reasonCode,
    summary,
    observedAt: Date.now(),
    durationMs: 0,
  }
}
