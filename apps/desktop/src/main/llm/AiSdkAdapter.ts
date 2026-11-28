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
  ModelCatalogProvider,
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
}

export interface ModelCatalogClientConfig {
  definition: ProviderDefinition
  connection?: ProviderConnectionSettings
  http?: AxiosInstance
}

/** Catalog listing only: no SDK provider or chat model is constructed for it. */
export function createModelCatalogClient(config: ModelCatalogClientConfig): ModelCatalogProvider {
  const connection = config.connection ?? {}
  const { chat } = config.definition
  const http =
    config.http ??
    axios.create({
      baseURL: chat.resolveBaseUrl?.(connection) ?? chat.baseUrl,
      ...(chat.localOnly
        ? { proxy: false, maxRedirects: 0, maxContentLength: 1_048_576, timeout: 5_000 }
        : { timeout: 60_000 }),
    })
  if (!config.http) {
    if (!chat.localOnly) installLlmProxyResolver(http)
    observeAxiosNetwork(http, 'llm')
  }
  return {
    fetchModels: (apiKey: string) => config.definition.fetchModels(http, apiKey, connection),
  }
}

/** Transport only: schemas have no execute callbacks; Shio retains its Tool Loop. */
export function createAiSdkAdapter(config: AiSdkAdapterConfig) {
  const { definition } = config
  const connection = config.connection ?? {}
  const model = config.model.trim()
  const base = resolveBaseCapabilities(definition.profile.id, model)
  const capabilities = config.capabilities ?? definition.resolveCapabilities?.(model, base) ?? base
  const provider = createOpenAICompatible({
    name: definition.profile.id,
    baseURL: definition.chat.resolveBaseUrl?.(connection) ?? definition.chat.baseUrl,
    apiKey: definition.profile.requiresApiKey ? config.apiKey || undefined : undefined,
    headers: definition.chat.headers,
    fetch: config.fetch ?? createOpenAISdkFetch(definition.chat.localOnly),
    includeUsage: true,
    supportsStructuredOutputs: capabilities.supportsSchemaOutput === true,
    transformRequestBody: (body) => ({
      ...body,
      ...(body.tools ? { parallel_tool_calls: false } : {}),
      ...definition.chat.requestOptions?.(model),
    }),
  })
  const client = provider.chatModel(model)
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
      requestTimeoutMs: definition.chat.requestTimeoutMs,
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
  }
}
