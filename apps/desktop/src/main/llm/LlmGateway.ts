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
  LlmCompletion,
  LlmCompletionOptions,
  LlmGatewaySettings,
  LlmRequestOptions,
  LlmStreamOptions,
} from './types'

export class LlmGateway implements LLMProvider {
  constructor(private readonly getSettings: () => LlmGatewaySettings) {}

  getActiveCapabilities(): LlmCapabilities {
    const { provider, model } = this.getSettings()
    return resolveModelCapabilities(provider, model)
  }

  capabilities(): LlmCapabilities {
    return this.getActiveCapabilities()
  }

  async refreshActiveCapabilities(): Promise<LlmCapabilities> {
    const { provider, apiKey, accountId } = this.getSettings()
    if (!hasLoadedModelCatalog(provider)) {
      const catalog = createModelCatalog(provider, { accountId })
      enrichModelCatalog(provider, await catalog.fetchModels(apiKey))
    }
    return this.getActiveCapabilities()
  }

  async chat(messages: readonly ChatMessage[], options: LlmRequestOptions = {}): Promise<string> {
    const { provider, apiKey, model, accountId } = this.getSettings()
    const profile = getProviderProfile(provider)
    if (
      (profile.requiresApiKey && !apiKey.trim()) ||
      (profile.requiresAccountId && !accountId?.trim())
    ) {
      throw new LlmCredentialMissingError()
    }
    const capabilities = resolveModelCapabilities(provider, model)
    const hasImage = messages.some(
      (message) =>
        typeof message.content !== 'string' &&
        message.content.some((part) => part.type === 'image'),
    )
    if (hasImage && !capabilities.supportsVision) throw new LlmCapabilityError()
    const active = createLLMProvider({ provider, apiKey, model, accountId })
    return active.chat(messages, options)
  }

  async complete(
    messages: readonly ChatMessage[],
    options: LlmCompletionOptions = {},
  ): Promise<LlmCompletion> {
    const { provider, apiKey, model, accountId } = this.getSettings()
    const profile = getProviderProfile(provider)
    if (
      (profile.requiresApiKey && !apiKey.trim()) ||
      (profile.requiresAccountId && !accountId?.trim())
    ) {
      throw new LlmCredentialMissingError()
    }
    const capabilities = resolveModelCapabilities(provider, model)
    const hasImage = messages.some(
      (message) =>
        typeof message.content !== 'string' &&
        message.content.some((part) => part.type === 'image'),
    )
    if (hasImage && !capabilities.supportsVision) throw new LlmCapabilityError()
    const active = createLLMProvider({ provider, apiKey, model, accountId })
    if (!active.complete) {
      return {
        content: await active.chat(messages, options),
        toolCalls: Object.freeze([]),
        finishReason: 'stop',
      }
    }
    return active.complete(messages, options)
  }

  stream(messages: readonly ChatMessage[], options: LlmStreamOptions = {}) {
    const { provider, apiKey, model, accountId } = this.getSettings()
    const profile = getProviderProfile(provider)
    if (
      (profile.requiresApiKey && !apiKey.trim()) ||
      (profile.requiresAccountId && !accountId?.trim())
    ) {
      throw new LlmCredentialMissingError()
    }
    const capabilities = resolveModelCapabilities(provider, model)
    if (!capabilities.supportsStreaming) throw new LlmCapabilityError()
    const hasImage = messages.some(
      (message) =>
        typeof message.content !== 'string' &&
        message.content.some((part) => part.type === 'image'),
    )
    if (hasImage && !capabilities.supportsVision) throw new LlmCapabilityError()
    const active = createLLMProvider({ provider, apiKey, model, accountId })
    if (!active.stream) throw new LlmCapabilityError()
    return active.stream(messages, options)
  }
}
