import type { LlmProviderId } from '../../../shared/llmProviders'

/**
 * Normalized, human-readable error for malformed / empty chat completions.
 * Providers throw this instead of letting a raw ZodError reach the UI.
 */
export class LlmResponseError extends Error {
  provider: LlmProviderId
  rawResponse: unknown

  constructor(params: { provider: LlmProviderId; message: string; rawResponse?: unknown }) {
    super(params.message)
    this.name = 'LlmResponseError'
    this.provider = params.provider
    this.rawResponse = params.rawResponse
  }
}
