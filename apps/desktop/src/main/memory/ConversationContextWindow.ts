import type { ChatMessage } from '../llm'
import { mainLog } from '../logging/safeLogger'
import type { MemoryStore } from './MemoryStore'

/** Verbatim recent turns, as before compaction (10 user/assistant turns). */
export const CONTEXT_WINDOW_MESSAGES = 20
export const SESSION_SUMMARY_MAX_CHARACTERS = 1_200
const EVICTED_PROSE_MAX_CHARACTERS = 6_000
/** Evicted prose lines collected before one summary call (about three turns). */
export const SUMMARY_BATCH_LINES = 6

export interface SessionProseLine {
  role: 'user' | 'assistant'
  text: string
}

/** Produces the next rolling summary from the previous one and newly evicted prose. */
export type SessionSummarizer = (
  input: { previousSummary: string | null; evicted: readonly SessionProseLine[] },
  signal: AbortSignal,
) => Promise<string>

interface SessionState {
  messages: ChatMessage[]
  summary: string | null
  pending: SessionProseLine[]
}

/** Only user prose and Character prose; failure presentations and tool payloads never enter. */
export function sessionProse(messages: readonly ChatMessage[]): SessionProseLine[] {
  return messages.flatMap((message): SessionProseLine[] => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    if (
      message.role === 'assistant' &&
      message.assistantTurnKind &&
      message.assistantTurnKind !== 'character'
    )
      return []
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n')
    const trimmed = text.trim()
    return trimmed ? [{ role: message.role, text: trimmed }] : []
  })
}

function boundedSummary(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) return null
  return normalized.length <= SESSION_SUMMARY_MAX_CHARACTERS
    ? normalized
    : `${normalized.slice(0, SESSION_SUMMARY_MAX_CHARACTERS - 1)}…`
}

/**
 * Process-memory conversation window: the latest turns verbatim plus one rolling
 * summary of evicted prose. Summarization is asynchronous, single-flight and
 * cancellable; a failure keeps the previous summary and the plain truncation.
 * Nothing here is persisted (Semantic Memory v1 forbids implicit durable capture).
 */
export class ConversationContextWindow implements MemoryStore {
  private readonly sessions = new Map<string, SessionState>()
  private readonly inFlight = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >()
  private disposed = false

  constructor(private readonly summarizer?: () => SessionSummarizer | undefined) {}

  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    return [...(this.sessions.get(sessionId)?.messages ?? [])]
  }

  async getSessionSummary(sessionId: string): Promise<string | null> {
    return this.sessions.get(sessionId)?.summary ?? null
  }

  async appendTurn(
    sessionId: string,
    turn: { user: ChatMessage; assistant: ChatMessage },
  ): Promise<void> {
    const state = this.state(sessionId)
    state.messages.push(turn.user, turn.assistant)
    if (state.messages.length <= CONTEXT_WINDOW_MESSAGES) return
    const evicted = state.messages.splice(0, state.messages.length - CONTEXT_WINDOW_MESSAGES)
    if (!this.summarizer?.()) return
    state.pending.push(...sessionProse(evicted))
    while (
      state.pending.reduce((sum, line) => sum + line.text.length, 0) > EVICTED_PROSE_MAX_CHARACTERS
    )
      state.pending.shift()
    this.scheduleSummary(sessionId)
  }

  async clear(sessionId: string): Promise<void> {
    this.cancel(sessionId)
    this.sessions.delete(sessionId)
  }

  /** Waits for an in-flight summary (tests and orderly shutdown). */
  async settle(sessionId: string): Promise<void> {
    await this.inFlight.get(sessionId)?.done
  }

  dispose(): void {
    this.disposed = true
    for (const sessionId of [...this.inFlight.keys()]) this.cancel(sessionId)
  }

  private state(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = { messages: [], summary: null, pending: [] }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private cancel(sessionId: string): void {
    this.inFlight
      .get(sessionId)
      ?.controller.abort(new DOMException('Session summary cancelled', 'AbortError'))
    this.inFlight.delete(sessionId)
  }

  private scheduleSummary(sessionId: string): void {
    if (this.disposed || this.inFlight.has(sessionId)) return
    const summarize = this.summarizer?.()
    const state = this.sessions.get(sessionId)
    if (!summarize || !state || state.pending.length < SUMMARY_BATCH_LINES) return
    const evicted = state.pending
    state.pending = []
    const controller = new AbortController()
    const done = (async () => {
      try {
        const next = await summarize({ previousSummary: state.summary, evicted }, controller.signal)
        if (controller.signal.aborted || this.sessions.get(sessionId) !== state) return
        state.summary = boundedSummary(next) ?? state.summary
      } catch (error) {
        if (!controller.signal.aborted)
          mainLog.warn('[ConversationContextWindow] summary failed; keeping plain truncation', {
            error: error instanceof Error ? error.name : 'unknown',
          })
      } finally {
        if (this.inFlight.get(sessionId)?.controller === controller) this.inFlight.delete(sessionId)
      }
      // Turns evicted while this summary ran are folded in by the next single flight.
      if (!controller.signal.aborted) this.scheduleSummary(sessionId)
    })()
    this.inFlight.set(sessionId, { controller, done })
  }
}
