import axios, { type AxiosInstance, type AxiosProxyConfig } from 'axios'

import type { LlmProviderId } from '../../../../shared/llmProviders'
import { type LlmCapabilities, resolveCapabilities } from '../../compatibility/index'
import { PROVIDER_DISPLAY_NAMES } from '../../errors/index'
import {
  type ChatRunConfig,
  type ParsedCompletion,
  runChatCompletion,
  runChatCompletionDetailed,
} from '../../protocol/index'
import type { ChatMessage, LLMProvider } from '../../public/chatTypes'
import type { ModelCatalogProvider, ModelInfo } from '../catalogTypes'

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

export interface BaseProviderConfig {
  providerId: LlmProviderId
  baseURL: string
  /** Chat endpoint path relative to baseURL. */
  chatPath: string
  proxy?: AxiosProxyConfig | false
  /** Provider-specific non-auth headers sent with chat requests. */
  chatHeaders?: Record<string, string>
}

/**
 * Shared base for every OpenAI-compatible provider. Owns provider resources and
 * delegates request compatibility/protocol behavior to the dedicated modules.
 * Subclasses only declare their endpoint configuration and implement catalogs.
 */
export abstract class BaseOpenAIProvider implements LLMProvider, ModelCatalogProvider {
  protected apiKey: string
  protected model: string
  protected http: AxiosInstance
  protected readonly config: BaseProviderConfig

  constructor(apiKey: string, model: string, config: BaseProviderConfig) {
    this.apiKey = apiKey.trim()
    this.model = model.trim()
    this.config = config
    this.http = axios.create({
      baseURL: config.baseURL,
      timeout: 60_000,
      proxy: config.proxy,
    })
  }

  capabilities(): LlmCapabilities {
    return resolveCapabilities(this.config.providerId, this.model)
  }

  private buildRunConfig(messages: ChatMessage[], opts?: ChatOptions): ChatRunConfig {
    if (!this.apiKey) {
      throw new Error(
        `${PROVIDER_DISPLAY_NAMES[this.config.providerId]}: API ключ не задан. Откройте Настройки и введите ключ.`,
      )
    }
    return {
      provider: this.config.providerId,
      http: this.http,
      chatPath: this.config.chatPath,
      apiKey: this.apiKey,
      model: this.model,
      capabilities: this.capabilities(),
      messages,
      extraHeaders: this.config.chatHeaders,
      temperature: opts?.temperature,
      maxTokensOverride: opts?.maxTokens,
    }
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    return runChatCompletion(this.buildRunConfig(messages))
  }

  async chatDetailed(messages: ChatMessage[], opts?: ChatOptions): Promise<ParsedCompletion> {
    return runChatCompletionDetailed(this.buildRunConfig(messages, opts))
  }

  abstract fetchModels(apiKey: string): Promise<ModelInfo[]>
}
