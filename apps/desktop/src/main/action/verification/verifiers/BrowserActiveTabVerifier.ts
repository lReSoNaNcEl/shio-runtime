import type { DesktopWorkflowRequest } from '../../../../shared/actions'
import type {
  ActionVerificationRequest,
  ActionVerificationResult,
  ActionVerifier,
} from '../contracts'
import { desktopWorkflowEvidence } from './desktopWorkflowEvidence'

export class BrowserActiveTabVerifier implements ActionVerifier {
  readonly id = 'browser-active-tab'

  async verify(request: ActionVerificationRequest): Promise<ActionVerificationResult> {
    const payload = request.payload as DesktopWorkflowRequest
    const evidence = desktopWorkflowEvidence(request.execution)
    const requestedTabId =
      evidence?.kind === 'browser' && evidence.requestedTabId
        ? evidence.requestedTabId
        : payload.browserOperation?.operation === 'switch-tab'
          ? payload.browserOperation.tabId
          : undefined
    const activeTabId =
      evidence?.kind === 'browser' ? evidence.afterSession?.activeTabId : undefined
    if (!requestedTabId || !activeTabId) {
      return result(
        'unverified',
        'browser-active-tab-unavailable',
        'The active browser tab could not be confirmed.',
      )
    }
    const verified = requestedTabId === activeTabId
    return {
      status: verified ? 'verified' : 'failed',
      evidence: [
        {
          kind: 'browser-active-tab',
          summary: verified
            ? 'The requested browser tab is active.'
            : 'A different browser tab is active.',
          details: { requestedTabId, activeTabId },
        },
      ],
      ...(!verified
        ? {
            reasonCode: 'browser-active-tab-mismatch',
            summary: 'The requested tab is not the active browser tab.',
          }
        : { summary: 'The requested browser tab is active.' }),
      observedAt: evidence?.kind === 'browser' ? evidence.after?.capturedAt : Date.now(),
      durationMs: 0,
    }
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
