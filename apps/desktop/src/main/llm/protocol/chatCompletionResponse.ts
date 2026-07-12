import type { LlmProviderId } from '../../../shared/llmProviders'
import { ChatCompletionSchema } from '../../schemas'
import { normalizeFinishReason, type RuntimeFinishReason } from '../compatibility/index'
import { LlmResponseError, PROVIDER_DISPLAY_NAMES } from '../errors/index'

export interface ParsedCompletion {
  content: string
  finishReason: RuntimeFinishReason
  hadReasoning: boolean
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

/**
 * Flatten `message.content` regardless of shape: a plain string passes
 * through unchanged; an array of typed content parts (used by some
 * reasoning models to separate "thinking" from "text" blocks) is reduced to
 * its text, with any thinking/reasoning blocks reported via `hadReasoning`
 * instead of leaking into the visible reply.
 */
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

/**
 * Provider-agnostic parsing of an OpenAI-compatible chat completion.
 *
 * Validates the envelope leniently, normalizes the finish reason, detects
 * reasoning output, and enforces the "non-empty string content" rule. Every
 * failure mode is converted into a readable {@link LlmResponseError} - a raw
 * Zod error never reaches the UI. Lives in one place so all providers behave
 * identically.
 */
export function parseChatCompletion(provider: LlmProviderId, raw: unknown): ParsedCompletion {
  const name = PROVIDER_DISPLAY_NAMES[provider]
  const parsed = ChatCompletionSchema.safeParse(raw)
  if (!parsed.success) {
    throw new LlmResponseError({
      provider,
      message: `${name}: \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u0442\u044c \u043e\u0442\u0432\u0435\u0442 \u043c\u043e\u0434\u0435\u043b\u0438.`,
      rawResponse: raw,
    })
  }

  // Some providers return errors as { error: {...} } with HTTP 200.
  if (parsed.data.error && (!parsed.data.choices || parsed.data.choices.length === 0)) {
    throw new LlmResponseError({
      provider,
      message: `${name}: API \u0432\u0435\u0440\u043d\u0443\u043b \u043e\u0448\u0438\u0431\u043a\u0443: ${shortPreview(parsed.data.error)}`,
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
          `${name}: \u0440\u0430\u0441\u0441\u0443\u0436\u0434\u0435\u043d\u0438\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043e, \u043d\u043e \u043b\u0438\u043c\u0438\u0442 \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u0438 \u0431\u044b\u043b \u0438\u0441\u0447\u0435\u0440\u043f\u0430\u043d \u0434\u043e \u0444\u0438\u043d\u0430\u043b\u044c\u043d\u043e\u0433\u043e \u043e\u0442\u0432\u0435\u0442\u0430. ` +
          '\u0423\u0432\u0435\u043b\u0438\u0447\u044c\u0442\u0435 \u043b\u0438\u043c\u0438\u0442 \u0442\u043e\u043a\u0435\u043d\u043e\u0432 \u0438\u043b\u0438 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043c\u043e\u0434\u0435\u043b\u044c \u0431\u0435\u0437 reasoning.',
        rawResponse: raw,
      })
    }
    if (finishReason === 'content_filter') {
      throw new LlmResponseError({
        provider,
        message: `${name}: \u043e\u0442\u0432\u0435\u0442 \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d \u0444\u0438\u043b\u044c\u0442\u0440\u043e\u043c \u043a\u043e\u043d\u0442\u0435\u043d\u0442\u0430.`,
        rawResponse: raw,
      })
    }
    throw new LlmResponseError({
      provider,
      message: `${name}: \u043c\u043e\u0434\u0435\u043b\u044c \u0432\u0435\u0440\u043d\u0443\u043b\u0430 \u043f\u0443\u0441\u0442\u043e\u0439 \u043e\u0442\u0432\u0435\u0442 (\u043d\u0435\u0442 choices[0].message.content).`,
      rawResponse: raw,
    })
  }

  return { content, finishReason, hadReasoning, usage }
}
