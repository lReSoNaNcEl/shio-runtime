import { ActionVerifierRegistry } from './ActionVerifierRegistry'
import {
  ActionVerificationCancelledError,
  type ActionVerificationRequest,
  type ActionVerificationResult,
  type ToolVerificationPolicy,
} from './contracts'
import { DEFAULT_VERIFICATION_TIMEOUT_MS, notRequiredVerification } from './VerificationPolicy'

export class ActionVerificationCoordinator {
  constructor(private readonly registry = new ActionVerifierRegistry()) {}

  registerVerifier(verifier: Parameters<ActionVerifierRegistry['register']>[0]): void {
    this.registry.register(verifier)
  }

  async verify(
    request: ActionVerificationRequest,
    policy: ToolVerificationPolicy,
  ): Promise<ActionVerificationResult> {
    if (policy.mode === 'none') return notRequiredVerification()
    if (request.signal.aborted) throw new ActionVerificationCancelledError()

    const startedAt = Date.now()
    const verifier = policy.verifier ? this.registry.resolve(policy.verifier) : undefined
    if (!verifier) {
      return {
        status: 'failed',
        evidence: [],
        reasonCode: 'verifier-unavailable',
        summary: 'The required verifier is unavailable.',
        observedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      }
    }

    const controller = new AbortController()
    const cancel = (): void => controller.abort()
    let rejectCancellation: (error: ActionVerificationCancelledError) => void = () => undefined
    const cancelVerification = (): void =>
      rejectCancellation(new ActionVerificationCancelledError())
    request.signal.addEventListener('abort', cancel, { once: true })
    request.signal.addEventListener('abort', cancelVerification, { once: true })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const verification = Promise.resolve(
        verifier.verify({ ...request, signal: controller.signal }),
      )
      const timedOut = new Promise<ActionVerificationResult>((resolve) => {
        timeout = setTimeout(() => {
          resolve({
            status: 'unverified',
            evidence: [],
            reasonCode: 'verification-timeout',
            summary: 'Verification did not finish within its bounded timeout.',
            observedAt: Date.now(),
            durationMs: Date.now() - startedAt,
          })
          controller.abort()
        }, policy.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS)
      })
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectCancellation = reject
        if (request.signal.aborted) {
          reject(new ActionVerificationCancelledError())
        }
      })
      const result = await Promise.race([verification, timedOut, cancelled])
      return {
        ...result,
        durationMs: Date.now() - startedAt,
      }
    } finally {
      if (timeout) clearTimeout(timeout)
      request.signal.removeEventListener('abort', cancel)
      request.signal.removeEventListener('abort', cancelVerification)
      controller.abort()
    }
  }
}
