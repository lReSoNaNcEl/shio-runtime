import type {
  ActionVerificationRequest,
  ActionVerificationResult,
  ActionVerifier,
} from '../contracts'
import {
  type BrowserObservationProvider,
  freshObservation,
  observationFingerprint,
} from './browserVerifierSupport'
import { desktopWorkflowEvidence } from './desktopWorkflowEvidence'

export class BrowserInteractionVerifier implements ActionVerifier {
  readonly id = 'browser-interaction'

  constructor(private readonly browser: BrowserObservationProvider) {}

  async verify(request: ActionVerificationRequest): Promise<ActionVerificationResult> {
    const evidence = desktopWorkflowEvidence(request.execution)
    if (evidence?.kind !== 'browser') {
      return result(
        'failed',
        'browser-evidence-missing',
        'Browser execution evidence is unavailable.',
      )
    }
    if (evidence.operation === 'workflow' && (evidence.successfulBrowserToolResults ?? 0) === 0) {
      return result(
        'failed',
        'browser-tool-evidence-missing',
        'The delegated workflow produced no successful browser tool result.',
      )
    }

    const after = evidence.after ?? (await freshObservation(this.browser, request.signal))
    if (!after) {
      return result(
        'failed',
        'browser-observation-unavailable',
        'The resulting browser state could not be observed.',
      )
    }
    if (!evidence.before) {
      return {
        status: 'unverified',
        evidence: [observationEvidence(after, false)],
        reasonCode: 'browser-baseline-missing',
        summary: 'A fresh browser state was observed, but there is no baseline for comparison.',
        observedAt: after.capturedAt,
        durationMs: 0,
      }
    }

    const changed = observationFingerprint(evidence.before) !== observationFingerprint(after)
    return {
      status: changed ? 'verified' : 'unverified',
      evidence: [observationEvidence(after, changed)],
      ...(!changed
        ? {
            reasonCode: 'browser-state-unchanged',
            summary: 'The interaction completed, but the observed page state did not change.',
          }
        : { summary: 'A fresh browser observation confirms a page-state change.' }),
      observedAt: after.capturedAt,
      durationMs: 0,
    }
  }
}

function observationEvidence(
  observation: Awaited<ReturnType<BrowserObservationProvider['observe']>>,
  changed: boolean,
) {
  return {
    kind: 'browser-interaction',
    summary: changed
      ? 'The browser page changed after the interaction.'
      : 'The browser page appears unchanged after the interaction.',
    details: {
      resultingUrl: observation.url,
      observationId: observation.observationId,
      stateChanged: changed,
    },
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
