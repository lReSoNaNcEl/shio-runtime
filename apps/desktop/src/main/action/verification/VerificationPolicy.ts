import type { ActionVerificationResult, ToolVerificationPolicy } from './contracts'

export const DEFAULT_VERIFICATION_TIMEOUT_MS = 15_000

export const NO_VERIFICATION_POLICY: ToolVerificationPolicy = Object.freeze({
  mode: 'none',
  retrySafety: 'never-auto',
})

export function notRequiredVerification(): ActionVerificationResult {
  return {
    status: 'not-required',
    evidence: [],
    summary: 'No post-execution verification is required for this Tool.',
    observedAt: Date.now(),
    durationMs: 0,
  }
}
