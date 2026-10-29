import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import axios, { type AxiosInstance } from 'axios'

import { observeAxiosNetwork } from '../diagnostics/observeAxiosNetwork'
import { LlmCredentialMissingError } from './errors'
import { createOpenAISdkFetch } from './openai-compatible/axiosFetch'
import { resolveBaseCapabilities } from './openai-compatible/capabilities'
import { installLlmProxyResolver } from './openai-compatible/proxy'
import { runChatCompletion, runChatCompletionDetailed } from './openai-compatible/request'
import { runChatCompletionStream } from './openai-compatible/stream'
import type {
  ChatMessage,
  LlmCapabilities,
  LlmCompletionOptions,
  LlmRequestOptions,
  LlmStreamOptions,
  ProviderConnectionSettings,
  ProviderDefinition,
} from './types'

export interface AiSdkAdapterConfig {
  definition: ProviderDefinition
  apiKey: string
  model: string
  connection?: ProviderConnectionSettings
  capabilities?: LlmCapabilities
  fetch?: typeof fetch
  catalogHttp?: AxiosInstance
}

/** Transport only: schemas have no execute callbacks; Shio retains its Tool Loop. */
export function createAiSdkAdapter(config: AiSdkAdapterConfig) {
  const { definition } = config
  const connection = config.connection ?? {}
  const model = definition.normalizeModelId?.(config.model.trim()) ?? config.model.trim()
  const base = resolveBaseCapabilities(definition.profile.id, model)
  const capabilities = config.capabilities ?? definition.resolveCapabilities?.(model, base) ?? base
  const provider = createOpenAICompatible({
    name: definition.profile.id,
    baseURL: definition.chat.resolveBaseUrl?.(connection) ?? definition.chat.baseUrl,
    apiKey: config.apiKey || undefined,
    headers: definition.chat.headers,
    fetch: config.fetch ?? createOpenAISdkFetch(),
    includeUsage: true,
    supportsStructuredOutputs: false,
    transformRequestBody: (body) => ({
      ...body,
      ...(body.tools ? { parallel_tool_calls: false } : {}),
    }),
  })
  const client = provider.chatModel(model)
  const http = config.catalogHttp ?? axios.create({ timeout: 60_000 })
  if (!config.catalogHttp) {
    installLlmProxyResolver(http)
    observeAxiosNetwork(http, 'llm')
  }
  const request = (messages: readonly ChatMessage[]) => {
    if (definition.profile.requiresApiKey && !config.apiKey.trim())
      throw new LlmCredentialMissingError()
    return {
      provider: definition.profile.id,
      displayName: definition.profile.displayName,
      client,
      model,
      capabilities,
      messages,
      singleLeadingSystemMessage: definition.chat.singleLeadingSystemMessage,
    }
  }
  return {
    capabilities: () => capabilities,
    chat: (messages: readonly ChatMessage[], options: LlmRequestOptions = {}) =>
      runChatCompletion(request(messages), options),
    complete: (messages: readonly ChatMessage[], options: LlmCompletionOptions = {}) =>
      runChatCompletionDetailed(request(messages), options),
    stream: (messages: readonly ChatMessage[], options: LlmStreamOptions = {}) =>
      runChatCompletionStream(request(messages), options),
    fetchModels: (apiKey: string) => definition.fetchModels(http, apiKey, connection),
  }
}
