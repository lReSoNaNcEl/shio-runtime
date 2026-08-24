import type { DesktopWorkflowRequest } from '../../../../shared/actions'
import type {
  ActionVerificationRequest,
  ActionVerificationResult,
  ActionVerifier,
} from '../contracts'
import { type BrowserObservationProvider, freshObservation } from './browserVerifierSupport'
import { desktopWorkflowEvidence } from './desktopWorkflowEvidence'

export class BrowserNavigationVerifier implements ActionVerifier {
  readonly id = 'browser-navigation'

  constructor(private readonly browser: BrowserObservationProvider) {}

  async verify(request: ActionVerificationRequest): Promise<ActionVerificationResult> {
    const payload = request.payload as DesktopWorkflowRequest
    const evidence = desktopWorkflowEvidence(request.execution)
    const requestedUrl =
      evidence?.kind === 'browser' && evidence.requestedUrl
        ? evidence.requestedUrl
        : payload.browserOperation?.operation === 'open'
          ? payload.browserOperation.url
          : payload.browserUrl
    if (!requestedUrl) {
      return failed('browser-expectation-missing', 'The requested browser URL is unavailable.')
    }

    const observed =
      evidence?.kind === 'browser' && evidence.after
        ? evidence.after
        : await freshObservation(this.browser, request.signal)
    if (!observed) {
      return failed(
        'browser-observation-unavailable',
        'The resulting browser state could not be observed.',
      )
    }

    const requestedOrigin = new URL(requestedUrl).origin
    const resultingOrigin = new URL(observed.url).origin
    const verified = requestedOrigin === resultingOrigin
    return {
      status: verified ? 'verified' : 'failed',
      evidence: [
        {
          kind: 'browser-navigation',
          summary: verified
            ? 'The browser reached the requested origin.'
            : 'The browser reached a different origin.',
          details: {
            requestedOrigin,
            resultingUrl: observed.url,
            observationId: observed.observationId,
          },
        },
      ],
      ...(!verified
        ? {
            reasonCode: 'browser-navigation-mismatch',
            summary: 'The resulting URL does not match the requested origin.',
          }
        : { summary: 'The requested page origin is visible in a fresh observation.' }),
      observedAt: observed.capturedAt,
      durationMs: 0,
    }
  }
}

function failed(reasonCode: string, summary: string): ActionVerificationResult {
  return {
    status: 'failed',
    evidence: [],
    reasonCode,
    summary,
    observedAt: Date.now(),
    durationMs: 0,
  }
}
