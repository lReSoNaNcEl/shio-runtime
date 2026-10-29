import type { LlmCompletion } from '../types'

export type RuntimeFinishReason = LlmCompletion['finishReason']
export interface ParsedCompletion extends LlmCompletion {
  hadReasoning: boolean
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

/** SDK-to-domain enum mapping; no provider response parsing. */
export function normalizeFinishReason(value: string | undefined | null): RuntimeFinishReason {
  if (value === 'tool-calls') return 'tool_calls'
  if (value === 'content-filter') return 'content_filter'
  return value === 'stop' || value === 'length' || value === 'error' ? value : 'unknown'
}
