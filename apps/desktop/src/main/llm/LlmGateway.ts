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
    const { provider, model, accountId } = this.getSettings()
    return resolveModelCapabilities(provider, model, { accountId })
  }

  capabilities(): LlmCapabilities {
    return this.getActiveCapabilities()
  }

  async refreshActiveCapabilities(): Promise<LlmCapabilities> {
    const { provider, apiKey, accountId } = this.getSettings()
    if (!hasLoadedModelCatalog(provider, { accountId })) {
      const catalog = createModelCatalog(provider, { accountId })
      enrichModelCatalog(provider, await catalog.fetchModels(apiKey), { accountId })
    }
    return this.getActiveCapabilities()
  }

  async chat(messages: readonly ChatMessage[], options: LlmRequestOptions = {}): Promise<string> {
    return this.prepare(messages).chat(messages, options)
  }

  async complete(
    messages: readonly ChatMessage[],
    options: LlmCompletionOptions = {},
  ): Promise<LlmCompletion> {
    const active = this.prepare(messages)
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
    const active = this.prepare(messages, { streaming: true })
    if (!active.stream) throw new LlmCapabilityError()
    return active.stream(messages, options)
  }

  /** Shared request admission: credentials, then streaming, then vision, then the adapter. */
  private prepare(
    messages: readonly ChatMessage[],
    { streaming = false }: { streaming?: boolean } = {},
  ): LLMProvider {
    const { provider, apiKey, model, accountId } = this.getSettings()
    const profile = getProviderProfile(provider)
    if (
      (profile.requiresApiKey && !apiKey.trim()) ||
      (profile.requiresAccountId && !accountId?.trim())
    ) {
      throw new LlmCredentialMissingError()
    }
    const capabilities = resolveModelCapabilities(provider, model, { accountId })
    if (streaming && !capabilities.supportsStreaming) throw new LlmCapabilityError()
    const hasImage = messages.some(
      (message) =>
        typeof message.content !== 'string' &&
        message.content.some((part) => part.type === 'image'),
    )
    if (hasImage && !capabilities.supportsVision) throw new LlmCapabilityError()
    return createLLMProvider({ provider, apiKey, model, accountId, capabilities })
  }
}
