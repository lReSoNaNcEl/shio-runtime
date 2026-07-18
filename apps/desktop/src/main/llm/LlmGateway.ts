import { LlmCapabilityError } from './errors'
import { createLLMProvider, resolveModelCapabilities } from './registry'
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

  async chat(messages: readonly ChatMessage[], options: LlmRequestOptions = {}): Promise<string> {
    const { provider, apiKey, model } = this.getSettings()
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
