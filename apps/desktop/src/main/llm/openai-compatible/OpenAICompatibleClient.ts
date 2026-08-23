import axios, { type AxiosInstance } from 'axios'

import { observeAxiosNetwork } from '../../diagnostics/observeAxiosNetwork'
import type {
  ChatMessage,
  LLMProvider,
  LlmCapabilities,
  LlmRequestOptions,
  ModelCatalogProvider,
  ProviderDefinition,
} from '../types'
import { resolveBaseCapabilities } from './capabilities'
import { proxyFromEnv } from './proxy'
import { runChatCompletion, runChatCompletionDetailed } from './request'
import type { ParsedCompletion } from './response'

export interface OpenAICompatibleClientConfig {
  definition: ProviderDefinition
  apiKey: string
  model: string
  capabilities?: LlmCapabilities
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

export class OpenAICompatibleClient implements LLMProvider, ModelCatalogProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly http: AxiosInstance
  private readonly definition: ProviderDefinition
  private readonly resolvedCapabilities?: LlmCapabilities

  constructor(config: OpenAICompatibleClientConfig) {
    this.definition = config.definition
    this.apiKey = config.apiKey.trim()
    this.model = config.model.trim()
    this.resolvedCapabilities = config.capabilities
    this.http = axios.create({
      baseURL: config.definition.chat.baseUrl,
      timeout: 60_000,
      proxy: config.definition.chat.useEnvironmentProxy ? proxyFromEnv() : undefined,
    })
    observeAxiosNetwork(this.http, 'llm')
  }

  capabilities(): LlmCapabilities {
    if (this.resolvedCapabilities) return this.resolvedCapabilities
    const base = resolveBaseCapabilities(this.definition.profile.id, this.model)
    return this.definition.resolveCapabilities?.(this.model, base) ?? base
  }

  async chat(messages: readonly ChatMessage[], options: LlmRequestOptions = {}): Promise<string> {
    if (!this.apiKey) {
      throw new Error(
        `${this.definition.profile.displayName}: API ключ не задан. Откройте Настройки и введите ключ.`,
      )
    }
    return runChatCompletion(
      {
        provider: this.definition.profile.id,
        displayName: this.definition.profile.displayName,
        http: this.http,
        chatPath: this.definition.chat.path,
        apiKey: this.apiKey,
        model: this.model,
        capabilities: this.capabilities(),
        messages,
        extraHeaders: this.definition.chat.headers,
      },
      options,
    )
  }

  async chatDetailed(
    messages: readonly ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ParsedCompletion> {
    if (!this.apiKey) {
      throw new Error(
        `${this.definition.profile.displayName}: API ключ не задан. Откройте Настройки и введите ключ.`,
      )
    }
    return runChatCompletionDetailed({
      provider: this.definition.profile.id,
      displayName: this.definition.profile.displayName,
      http: this.http,
      chatPath: this.definition.chat.path,
      apiKey: this.apiKey,
      model: this.model,
      capabilities: this.capabilities(),
      messages,
      extraHeaders: this.definition.chat.headers,
      temperature: options.temperature,
      maxTokensOverride: options.maxTokens,
    })
  }

  fetchModels(apiKey: string): Promise<import('../types').ModelCatalogEntry[]> {
    return this.definition.fetchModels(this.http, apiKey)
  }
}
