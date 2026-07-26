import { LlmCapabilityError, LlmCredentialMissingError } from './errors'
import {
  createLLMProvider,
  createModelCatalog,
  enrichModelCatalog,
  getProviderProfile,
  hasLoadedModelCatalog,
  resolveModelCapabilities,
} from './registry'
import type {
  ChatMessage,
  LLMProvider,
  LlmCapabilities,
  LlmGatewaySettings,
  LlmRequestOptions,
} from './types'

export class LlmGateway implements LLMProvider {
  constructor(private readonly getSettings: () => LlmGatewaySettings) {}

  getActiveCapabilities(): LlmCapabilities {
    const { provider, model } = this.getSettings()
    return resolveModelCapabilities(provider, model)
  }

  async refreshActiveCapabilities(): Promise<LlmCapabilities> {
    const { provider, apiKey } = this.getSettings()
    if (!hasLoadedModelCatalog(provider)) {
      const catalog = createModelCatalog(provider)
      enrichModelCatalog(provider, await catalog.fetchModels(apiKey))
    }
    return this.getActiveCapabilities()
  }

  async chat(messages: readonly ChatMessage[], options: LlmRequestOptions = {}): Promise<string> {
    const { provider, apiKey, model } = this.getSettings()
    if (getProviderProfile(provider).requiresApiKey && !apiKey.trim()) {
      throw new LlmCredentialMissingError()
    }
    const capabilities = resolveModelCapabilities(provider, model)
    const hasImage = messages.some(
      (message) =>
        typeof message.content !== 'string' &&
        message.content.some((part) => part.type === 'image'),
    )
    if (hasImage && !capabilities.supportsVision) throw new LlmCapabilityError()
    const active = createLLMProvider({ provider, apiKey, model })
    return active.chat(messages, options)
  }
}
