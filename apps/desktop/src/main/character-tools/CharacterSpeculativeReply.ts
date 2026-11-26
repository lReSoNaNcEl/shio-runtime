import type { LlmCompletion } from '../llm'
import type { CharacterToolLoopStreamEvent } from './CharacterToolLoop'

/** Upper bounds of a speculative direct reply held back while planning runs. */
export const SPECULATIVE_REPLY_MAX_CHARACTERS = 6_000
export const SPECULATIVE_REPLY_MAX_AGE_MS = 20_000

export type SpeculativeReplyDiscardReason =
  | 'plan-mismatch'
  | 'buffer-overflow'
  | 'expired'
  | 'cancelled'
  | 'failed'

export interface SpeculativeReplyObserver {
  onReleased?(event: { bufferedCharacters: number; waitedMs: number }): void
  onDiscarded?(event: { reason: SpeculativeReplyDiscardReason; bufferedCharacters: number }): void
}

/**
 * One direct-answer request started in parallel with Tool Requirement planning.
 * Every event is held back until the plan proves the speculation was the exact
 * request the turn would make; then the buffer is released in order and live
 * events follow. Otherwise the upstream request is aborted and nothing is shown.
 */
export class SpeculativeDirectReply {
  private readonly controller = new AbortController()
  readonly signal: AbortSignal
  private readonly startedAt: number
  private buffered: CharacterToolLoopStreamEvent[] = []
  private bufferedCharacters = 0
  private sink: ((event: CharacterToolLoopStreamEvent) => void) | null = null
  private forwardedText = false
  private settled: 'pending' | 'released' | 'discarded' = 'pending'
  private failed = false
  readonly completion: Promise<LlmCompletion>

  constructor(
    parentSignal: AbortSignal,
    start: (
      onEvent: (event: CharacterToolLoopStreamEvent) => void,
      signal: AbortSignal,
    ) => Promise<LlmCompletion>,
    private readonly now: () => number = Date.now,
    private readonly observer: SpeculativeReplyObserver = {},
  ) {
    this.startedAt = now()
    this.signal = AbortSignal.any([parentSignal, this.controller.signal])
    this.completion = start((event) => this.accept(event), this.signal).then((completion) => {
      if (
        this.settled === 'pending' &&
        completion.content.length > SPECULATIVE_REPLY_MAX_CHARACTERS
      )
        this.discard('buffer-overflow')
      this.signal.throwIfAborted()
      return completion
    })
    // The owner awaits the completion only after a release; never leave it unobserved.
    this.completion.catch(() => {
      this.failed = true
    })
  }

  /** Whether any visible text reached the real stream after release. */
  hasForwardedText(): boolean {
    return this.forwardedText
  }

  /** Releases the held events in order through `sink`; live events follow. */
  release(
    sink: (event: CharacterToolLoopStreamEvent) => void,
    turnSignal?: AbortSignal,
  ): Promise<LlmCompletion> | null {
    if (this.settled !== 'pending' || this.signal.aborted || turnSignal?.aborted) return null
    if (this.failed) {
      // A request that already failed must not flush partial text before its error.
      this.discard('failed')
      return null
    }
    if (this.now() - this.startedAt > SPECULATIVE_REPLY_MAX_AGE_MS) {
      this.discard('expired')
      return null
    }
    this.settled = 'released'
    if (turnSignal) {
      // A watch preparation starts under its capture lease. After admission the
      // turn's cancellation and deadline must also stop the actual provider.
      const abort = () => this.controller.abort(turnSignal.reason)
      turnSignal.addEventListener('abort', abort, { once: true })
      const detach = () => turnSignal.removeEventListener('abort', abort)
      void this.completion.then(detach, detach)
    }
    this.observer.onReleased?.({
      bufferedCharacters: this.bufferedCharacters,
      waitedMs: this.now() - this.startedAt,
    })
    const releasedAt = this.now()
    this.sink = sink
    const held = this.buffered
    this.buffered = []
    // Re-stamped: a held event becomes visible only now.
    for (const event of held) this.forward({ ...event, at: Math.max(event.at, releasedAt) })
    return this.completion
  }

  discard(reason: SpeculativeReplyDiscardReason): void {
    if (this.settled !== 'pending') return
    const discardReason = this.signal.aborted ? 'cancelled' : reason
    this.settled = 'discarded'
    this.buffered = []
    this.controller.abort(new DOMException(`Speculative reply ${discardReason}`, 'AbortError'))
    this.observer.onDiscarded?.({
      reason: discardReason,
      bufferedCharacters: this.bufferedCharacters,
    })
  }

  private accept(event: CharacterToolLoopStreamEvent): void {
    if (this.signal.aborted) return
    if (this.sink) {
      this.forward(event)
      return
    }
    this.buffered.push(event)
    if (event.type === 'text-delta') this.bufferedCharacters += event.delta.text.length
    if (this.bufferedCharacters > SPECULATIVE_REPLY_MAX_CHARACTERS) this.discard('buffer-overflow')
  }

  private forward(event: CharacterToolLoopStreamEvent): void {
    if (this.signal.aborted) return
    if (event.type === 'text-delta' && /\S/u.test(event.delta.text)) this.forwardedText = true
    this.sink?.(event)
  }
}
