import axios, { type AxiosInstance } from 'axios'

import type { LlmProviderId } from '../../../shared/llm'
import { llmDebug } from '../diagnostics'
import { LlmResponseError, networkErrorMessage, normalizeHttpErrorMessage } from '../errors'
import type { ChatMessage, LlmCapabilities, LlmRequestOptions } from '../types'
import { prepareMessages } from './messageCompatibility'
import { type ParsedCompletion, parseChatCompletion } from './response'

export interface ChatRunConfig {
  provider: LlmProviderId
  displayName: string
  http: AxiosInstance
  chatPath: string
  apiKey: string
  model: string
  capabilities: LlmCapabilities
  messages: readonly ChatMessage[]
  extraHeaders?: Record<string, string>
  temperature?: number
  maxTokensOverride?: number
}

const DEFAULT_TEMPERATURE = 0.7

export async function runChatCompletion(
  config: ChatRunConfig,
  options: LlmRequestOptions = {},
): Promise<string> {
  return (await runChatCompletionDetailed(config, options)).content
}

export async function runChatCompletionDetailed(
  config: ChatRunConfig,
  options: LlmRequestOptions = {},
): Promise<ParsedCompletion> {
  const started = Date.now()
  const body: Record<string, unknown> = {
    model: config.model,
    messages: prepareMessages(config.messages, config.capabilities),
    max_tokens: config.maxTokensOverride ?? config.capabilities.recommendedMaxTokens,
    stream: false,
  }
  if (config.capabilities.supportsTemperature) {
    body.temperature = config.temperature ?? DEFAULT_TEMPERATURE
  }

  try {
    const response = await config.http.post(config.chatPath, body, {
      headers: { Authorization: `Bearer ${config.apiKey}`, ...config.extraHeaders },
      signal: options.signal,
    })
    const parsed = parseChatCompletion(config.provider, config.displayName, response.data)
    llmDebug({
      provider: config.provider,
      model: config.model,
      finishReason: parsed.finishReason,
      latencyMs: Date.now() - started,
      hadReasoning: parsed.hadReasoning,
      contentEmpty: false,
      usage: parsed.usage,
    })
    return parsed
  } catch (error) {
    if (error instanceof LlmResponseError) {
      llmDebug({
        provider: config.provider,
        model: config.model,
        finishReason: 'error',
        latencyMs: Date.now() - started,
        hadReasoning: false,
        contentEmpty: true,
        error: error.message,
      })
      throw error
    }
    if (axios.isAxiosError(error) && error.response) {
      const message = normalizeHttpErrorMessage(config.displayName, error.response.status)
      llmDebug({
        provider: config.provider,
        model: config.model,
        finishReason: 'error',
        latencyMs: Date.now() - started,
        hadReasoning: false,
        contentEmpty: true,
        status: error.response.status,
        error: message,
      })
      throw new LlmResponseError({
        provider: config.provider,
        message,
        rawResponse: error.response.data,
      })
    }
    const message = networkErrorMessage(config.displayName)
    llmDebug({
      provider: config.provider,
      model: config.model,
      finishReason: 'error',
      latencyMs: Date.now() - started,
      hadReasoning: false,
      contentEmpty: true,
      error: message,
    })
    throw new LlmResponseError({ provider: config.provider, message })
  }
}
