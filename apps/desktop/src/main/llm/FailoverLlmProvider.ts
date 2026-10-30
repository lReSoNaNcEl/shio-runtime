import type { CharacterStreamEvent } from '../../shared/character-stream'
import {
  LlmCapabilityError,
  LlmCredentialMissingError,
  LlmResponseError,
  LlmTurnCancelledError,
} from './errors'
import type {
  ChatMessage,
  LLMProvider,
  LlmCompletion,
  LlmCompletionOptions,
  LlmRequestOptions,
  LlmStreamOptions,
} from './types'

/** Whether a failure of one candidate lets the next candidate serve the request.
 * Only failures before any response byte qualify; cancellation, validation and
 * malformed output never move to another provider. */
export function failoverDisposition(error: unknown): 'next' | 'stop' {
  if (error instanceof LlmCredentialMissingError || error instanceof LlmCapabilityError)
    return 'next'
  if (!(error instanceof LlmResponseError)) return 'stop'
  switch (error.code) {
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
    case 'AUTH_ERROR':
    case 'ACCESS_DENIED':
      return 'next'
    case 'PROVIDER_REJECTED':
      // Recoverable provider rejections are 5xx; a 4xx request error would repeat.
      return error.recoverable ? 'next' : 'stop'
    default:
      return 'stop'
  }
}

export interface FailoverCandidate {
  /** Non-secret identity for telemetry, e.g. "groq/openai/gpt-oss-120b". */
  label: string
  /** Prepares the candidate; it may throw a credential or capability error. */
  provider: () => LLMProvider
}

export interface FailoverObserver {
  onFailover?(event: { from: string; to: string; code: string }): void
  onServed?(event: { label: string; attempt: number }): void
}

const CONNECTION_EVENTS = new Set<CharacterStreamEvent['type']>(['connected'])

/** Ordered candidate decorator with the same LLMProvider contract as its candidates. */
export class FailoverLlmProvider implements LLMProvider {
  constructor(
    private readonly candidates: () => readonly FailoverCandidate[],
    private readonly observer: FailoverObserver = {},
  ) {}

  chat(messages: readonly ChatMessage[], options: LlmRequestOptions = {}): Promise<string> {
    return this.attempt(options.signal, (provider) => provider.chat(messages, options))
  }

  complete(
    messages: readonly ChatMessage[],
    options: LlmCompletionOptions = {},
  ): Promise<LlmCompletion> {
    return this.attempt(options.signal, async (provider) =>
      provider.complete
        ? provider.complete(messages, options)
        : {
            content: await provider.chat(messages, options),
            toolCalls: Object.freeze([]),
            finishReason: 'stop',
          },
    )
  }

  async *stream(
    messages: readonly ChatMessage[],
    options: LlmStreamOptions = {},
  ): AsyncIterable<CharacterStreamEvent> {
    const candidates = this.candidates()
    let lastError: unknown = new LlmCredentialMissingError()
    for (const [index, candidate] of candidates.entries()) {
      if (options.signal?.aborted) throw new LlmTurnCancelledError()
      const held: CharacterStreamEvent[] = []
      let started = false
      try {
        const provider = candidate.provider()
        if (!provider.stream) throw new LlmCapabilityError()
        for await (const event of provider.stream(messages, options)) {
          if (!started && CONNECTION_EVENTS.has(event.type)) {
            held.push(event)
            continue
          }
          if (!started) {
            started = true
            this.observer.onServed?.({ label: candidate.label, attempt: index })
            yield* held
          }
          yield event
        }
        if (!started) {
          this.observer.onServed?.({ label: candidate.label, attempt: index })
          yield* held
        }
        return
      } catch (error) {
        // After the first response byte the stream belongs to this candidate.
        if (started || failoverDisposition(error) === 'stop' || options.signal?.aborted) throw error
        lastError = error
        this.reportFailover(candidates, index, error)
      }
    }
    throw lastError
  }

  private async attempt<T>(
    signal: AbortSignal | undefined,
    run: (provider: LLMProvider) => Promise<T>,
  ): Promise<T> {
    const candidates = this.candidates()
    let lastError: unknown = new LlmCredentialMissingError()
    for (const [index, candidate] of candidates.entries()) {
      if (signal?.aborted) throw new LlmTurnCancelledError()
      try {
        const result = await run(candidate.provider())
        this.observer.onServed?.({ label: candidate.label, attempt: index })
        return result
      } catch (error) {
        if (failoverDisposition(error) === 'stop' || signal?.aborted) throw error
        lastError = error
        this.reportFailover(candidates, index, error)
      }
    }
    throw lastError
  }

  private reportFailover(
    candidates: readonly FailoverCandidate[],
    index: number,
    error: unknown,
  ): void {
    const next = candidates[index + 1]
    if (!next) return
    const code =
      error instanceof LlmResponseError ||
      error instanceof LlmCredentialMissingError ||
      error instanceof LlmCapabilityError
        ? error.code
        : 'UNKNOWN'
    this.observer.onFailover?.({ from: candidates[index].label, to: next.label, code })
  }
}
