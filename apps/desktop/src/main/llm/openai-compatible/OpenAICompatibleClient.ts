import axios, { type AxiosInstance } from 'axios'
import OpenAI from 'openai'

import { observeAxiosNetwork } from '../../diagnostics/observeAxiosNetwork'
import type {
  ChatMessage,
  LLMProvider,
  LlmCapabilities,
  LlmCompletion,
  LlmCompletionOptions,
  LlmRequestOptions,
  LlmStreamOptions,
  ModelCatalogProvider,
  ProviderConnectionSettings,
  ProviderDefinition,
} from '../types'
import { createOpenAISdkFetch } from './axiosFetch'
import { resolveBaseCapabilities } from './capabilities'
import { installLlmProxyResolver } from './proxy'
import { runChatCompletion, runChatCompletionDetailed } from './request'
import type { ParsedCompletion } from './response'
import { runChatCompletionStream } from './stream'

export interface OpenAICompatibleClientConfig {
  definition: ProviderDefinition
  apiKey: string
  model: string
  connection?: ProviderConnectionSettings
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
  private readonly client: OpenAI
  private readonly definition: ProviderDefinition
  private readonly connection: ProviderConnectionSettings
  private readonly resolvedCapabilities?: LlmCapabilities

  constructor(config: OpenAICompatibleClientConfig) {
    this.definition = config.definition
    this.connection = config.connection ?? {}
    this.apiKey = config.apiKey.trim()
    const model = config.model.trim()
    this.model = config.definition.normalizeModelId?.(model) ?? model
    this.resolvedCapabilities = config.capabilities
    this.http = axios.create({
      baseURL: this.chatBaseUrl(),
      timeout: 60_000,
    })
    installLlmProxyResolver(this.http)
    observeAxiosNetwork(this.http, 'llm')
    this.client = new OpenAI({
      apiKey: this.apiKey || 'shio-missing-key',
      baseURL: this.chatBaseUrl(),
      defaultHeaders: this.definition.chat.headers,
      fetch: createOpenAISdkFetch(),
      maxRetries: 0,
      timeout: 2_147_483_647,
    })
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
        client: this.client,
        model: this.model,
        capabilities: this.capabilities(),
        messages,
        singleLeadingSystemMessage: this.definition.chat.singleLeadingSystemMessage,
      },
      options,
    )
  }

  async complete(
    messages: readonly ChatMessage[],
    options: LlmCompletionOptions = {},
  ): Promise<LlmCompletion> {
    if (!this.apiKey) {
      throw new Error(
        `${this.definition.profile.displayName}: API ключ не задан. Откройте Настройки и введите ключ.`,
      )
    }
    const completion = await runChatCompletionDetailed(
      {
        provider: this.definition.profile.id,
        displayName: this.definition.profile.displayName,
        client: this.client,
        model: this.model,
        capabilities: this.capabilities(),
        messages,
        singleLeadingSystemMessage: this.definition.chat.singleLeadingSystemMessage,
      },
      options,
    )
    return {
      content: completion.content,
      toolCalls: completion.toolCalls,
      finishReason: completion.finishReason,
    }
  }

  stream(messages: readonly ChatMessage[], options: LlmStreamOptions = {}) {
    if (!this.apiKey) {
      throw new Error(
        `${this.definition.profile.displayName}: API ключ не задан. Откройте Настройки и введите ключ.`,
      )
    }
    if (!this.capabilities().supportsStreaming) {
      throw new Error(`${this.definition.profile.displayName}: streaming is not supported.`)
    }
    return runChatCompletionStream(
      {
        provider: this.definition.profile.id,
        displayName: this.definition.profile.displayName,
        client: this.client,
        model: this.model,
        capabilities: this.capabilities(),
        messages,
        singleLeadingSystemMessage: this.definition.chat.singleLeadingSystemMessage,
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
      client: this.client,
      model: this.model,
      capabilities: this.capabilities(),
      messages,
      singleLeadingSystemMessage: this.definition.chat.singleLeadingSystemMessage,
      temperature: options.temperature,
      maxTokensOverride: options.maxTokens,
    })
  }

  fetchModels(apiKey: string): Promise<import('../types').ModelCatalogEntry[]> {
    return this.definition.fetchModels(this.http, apiKey, this.connection)
  }

  private chatBaseUrl(): string {
    return this.definition.chat.resolveBaseUrl?.(this.connection) ?? this.definition.chat.baseUrl
  }
}
