import type { LlmProviderId } from '../../../shared/llm'
import { mainLog } from '../../logging/safeLogger'
import { LlmResponseError } from '../errors'
import type { LlmFinishReason, LlmToolCall } from '../types'
import { ChatCompletionSchema } from './schemas'

export type RuntimeFinishReason = LlmFinishReason

export interface ParsedCompletion {
  content: string
  toolCalls: readonly LlmToolCall[]
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

export function parseChatCompletion(
  provider: LlmProviderId,
  displayName: string,
  raw: unknown,
): ParsedCompletion {
  const parsed = ChatCompletionSchema.safeParse(raw)
  if (!parsed.success) {
    mainLog.warn('[LLM] response schema rejected', {
      provider,
      issues: parsed.error.issues.slice(0, 8).map((issue) => ({
        code: issue.code,
        path: issue.path.slice(0, 8),
        message: issue.message.slice(0, 300),
      })),
    })
    throw new LlmResponseError({
      provider,
      code: 'PROVIDER_REJECTED',
      recoverable: false,
      message: `${displayName}: не удалось разобрать ответ модели.`,
    })
  }

  if (parsed.data.error && (!parsed.data.choices || parsed.data.choices.length === 0)) {
    throw new LlmResponseError({
      provider,
      code: 'PROVIDER_REJECTED',
      recoverable: false,
      message: `${displayName}: API отклонил запрос.`,
    })
  }

  const choice = parsed.data.choices?.[0]
  const message = choice?.message
  const finishReason = normalizeFinishReason(choice?.finish_reason)
  const reasoning = message?.reasoning ?? message?.reasoning_content
  const extracted = extractMessageContent(message?.content)
  const toolCalls = Object.freeze(
    (message?.tool_calls ?? []).map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      argumentsJson: toolCall.function.arguments,
    })),
  )
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
  if (content.length === 0 && toolCalls.length === 0) {
    if (finishReason === 'length') {
      throw new LlmResponseError({
        provider,
        code: 'PROVIDER_REJECTED',
        recoverable: true,
        message:
          `${displayName}: рассуждение завершено, но лимит генерации был исчерпан до финального ответа. ` +
          'Увеличьте лимит токенов или выберите модель без reasoning.',
      })
    }
    if (finishReason === 'content_filter') {
      throw new LlmResponseError({
        provider,
        code: 'PROVIDER_REJECTED',
        recoverable: false,
        message: `${displayName}: ответ заблокирован фильтром контента.`,
      })
    }
    throw new LlmResponseError({
      provider,
      code: 'PROVIDER_REJECTED',
      recoverable: true,
      message: `${displayName}: модель вернула пустой ответ (нет choices[0].message.content).`,
    })
  }

  return { content, toolCalls, finishReason, hadReasoning, usage }
}
