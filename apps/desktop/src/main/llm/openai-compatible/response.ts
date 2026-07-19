import type { LlmProviderId } from '../../../shared/llm'
import { LlmResponseError } from '../errors'
import { ChatCompletionSchema } from './schemas'

export type RuntimeFinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'error'
  | 'unknown'

export interface ParsedCompletion {
  content: string
  finishReason: RuntimeFinishReason
  hadReasoning: boolean
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

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

function extractMessageContent(content: unknown): { text: string; hadReasoning: boolean } {
  if (typeof content === 'string') return { text: content, hadReasoning: false }
  if (!Array.isArray(content)) return { text: '', hadReasoning: false }

  let hadReasoning = false
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const { type, text } = block as { type?: string; text?: string }
    if (type === 'thinking' || type === 'reasoning') {
      hadReasoning = true
      continue
    }
    if (typeof text === 'string') parts.push(text)
  }
  return { text: parts.join(''), hadReasoning }
}

function shortPreview(value: unknown): string {
  try {
    const json = JSON.stringify(value)
    if (!json) return String(value)
    return json.length > 300 ? `${json.slice(0, 300)}...` : json
  } catch {
    return String(value)
  }
}

export function parseChatCompletion(
  provider: LlmProviderId,
  displayName: string,
  raw: unknown,
): ParsedCompletion {
  const parsed = ChatCompletionSchema.safeParse(raw)
  if (!parsed.success) {
    throw new LlmResponseError({
      provider,
      message: `${displayName}: не удалось разобрать ответ модели.`,
      rawResponse: raw,
    })
  }

  if (parsed.data.error && (!parsed.data.choices || parsed.data.choices.length === 0)) {
    throw new LlmResponseError({
      provider,
      message: `${displayName}: API вернул ошибку: ${shortPreview(parsed.data.error)}`,
      rawResponse: raw,
    })
  }

  const choice = parsed.data.choices?.[0]
  const message = choice?.message
  const finishReason = normalizeFinishReason(choice?.finish_reason)
  const reasoning = message?.reasoning ?? message?.reasoning_content
  const extracted = extractMessageContent(message?.content)
  const hadReasoning =
    (typeof reasoning === 'string' && reasoning.length > 0) || extracted.hadReasoning
  const usage = parsed.data.usage
    ? {
        promptTokens: parsed.data.usage.prompt_tokens,
        completionTokens: parsed.data.usage.completion_tokens,
        totalTokens: parsed.data.usage.total_tokens,
      }
    : undefined

  const content = extracted.text
  if (content.length === 0) {
    if (finishReason === 'length') {
      throw new LlmResponseError({
        provider,
        message:
          `${displayName}: рассуждение завершено, но лимит генерации был исчерпан до финального ответа. ` +
          'Увеличьте лимит токенов или выберите модель без reasoning.',
        rawResponse: raw,
      })
    }
    if (finishReason === 'content_filter') {
      throw new LlmResponseError({
        provider,
        message: `${displayName}: ответ заблокирован фильтром контента.`,
        rawResponse: raw,
      })
    }
    throw new LlmResponseError({
      provider,
      message: `${displayName}: модель вернула пустой ответ (нет choices[0].message.content).`,
      rawResponse: raw,
    })
  }

  return { content, finishReason, hadReasoning, usage }
}
