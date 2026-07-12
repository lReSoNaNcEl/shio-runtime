/**
 * Common Runtime finish-reason semantics. Provider-specific finish reasons are
 * normalized here so no raw provider value leaks outside the adapter.
 */
export type RuntimeFinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'error'
  | 'unknown'

export function normalizeFinishReason(raw: string | null | undefined): RuntimeFinishReason {
  switch ((raw ?? '').toLowerCase()) {
    case 'stop':
    case 'end_turn':
    case 'eos':
    case 'complete':
      return 'stop'
    case 'length':
    case 'max_tokens':
    case 'model_length':
      return 'length'
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls'
    case 'content_filter':
    case 'content_filtered':
      return 'content_filter'
    case 'error':
      return 'error'
    default:
      return 'unknown'
  }
}
