import axios, { type AxiosInstance } from 'axios'
import type { LlmProviderId } from '../../../shared/llmProviders'
import type { ChatMessage } from '../public/chatTypes'
import type { LlmCapabilities } from '../compatibility/index'
import { prepareMessages } from '../compatibility/index'
import { LlmResponseError, normalizeHttpErrorMessage, networkErrorMessage } from '../errors/index'
import { llmDebug } from '../diagnostics/index'
import { parseChatCompletion, type ParsedCompletion } from './chatCompletionResponse'

export interface ChatRunConfig {
  provider: LlmProviderId
  http: AxiosInstance
  chatPath: string
  apiKey: string
  model: string
  capabilities: LlmCapabilities
  messages: ChatMessage[]
  /** Provider-specific non-auth headers (e.g. OpenRouter attribution). */
  extraHeaders?: Record<string, string>
  /** Override sampling temperature (default 0.7); ignored if unsupported. */
  temperature?: number
  /** Override the capability-derived token budget (diagnostics/tests). */
  maxTokensOverride?: number
}

const DEFAULT_TEMPERATURE = 0.7

/**
 * Single request runner shared by every OpenAI-compatible provider. Builds the
 * HTTP request from resolved compatibility, parses the response through the
 * common protocol path, observes diagnostics, and normalizes transport errors.
 */
export async function runChatCompletion(cfg: ChatRunConfig): Promise<string> {
  return (await runChatCompletionDetailed(cfg)).content
}

export async function runChatCompletionDetailed(cfg: ChatRunConfig): Promise<ParsedCompletion> {
  const started = Date.now()

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: prepareMessages(cfg.messages, cfg.capabilities),
    max_tokens: cfg.maxTokensOverride ?? cfg.capabilities.recommendedMaxTokens,
    stream: false
  }
  if (cfg.capabilities.supportsTemperature) body.temperature = cfg.temperature ?? DEFAULT_TEMPERATURE

  try {
    const res = await cfg.http.post(cfg.chatPath, body, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, ...cfg.extraHeaders }
    })
    const parsed = parseChatCompletion(cfg.provider, res.data)
    llmDebug({
      provider: cfg.provider,
      model: cfg.model,
      finishReason: parsed.finishReason,
      latencyMs: Date.now() - started,
      hadReasoning: parsed.hadReasoning,
      contentEmpty: false,
      usage: parsed.usage
    })
    return parsed
  } catch (e) {
    if (e instanceof LlmResponseError) {
      llmDebug({
        provider: cfg.provider,
        model: cfg.model,
        finishReason: 'error',
        latencyMs: Date.now() - started,
        hadReasoning: false,
        contentEmpty: true,
        error: e.message
      })
      throw e
    }
    if (axios.isAxiosError(e) && e.response) {
      const message = normalizeHttpErrorMessage(cfg.provider, e.response.status)
      llmDebug({
        provider: cfg.provider,
        model: cfg.model,
        finishReason: 'error',
        latencyMs: Date.now() - started,
        hadReasoning: false,
        contentEmpty: true,
        status: e.response.status,
        error: message
      })
      throw new LlmResponseError({ provider: cfg.provider, message, rawResponse: e.response.data })
    }
    const message = networkErrorMessage(cfg.provider)
    llmDebug({
      provider: cfg.provider,
      model: cfg.model,
      finishReason: 'error',
      latencyMs: Date.now() - started,
      hadReasoning: false,
      contentEmpty: true,
      error: message
    })
    throw new LlmResponseError({ provider: cfg.provider, message })
  }
}
