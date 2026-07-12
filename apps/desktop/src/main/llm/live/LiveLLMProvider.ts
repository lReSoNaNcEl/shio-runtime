import { createLLMProvider } from '../registry/index'
import type { LlmProviderId } from '../../../shared/llmProviders'
import type { ChatMessage, LLMProvider } from '../public/chatTypes'

export interface LiveLLMSettings {
  provider: LlmProviderId
  apiKey: string
  model: string
}

/**
 * Runtime-facing LLM adapter that always reflects the current Settings.
 *
 * The Orchestrator holds one long-lived instance of this class. Each `chat()`
 * call re-reads settings and builds a fresh provider instance, so changing
 * provider / model / apiKey in the Settings UI takes effect on the very next
 * request without restarting Shio Runtime.
 */
export class LiveLLMProvider implements LLMProvider {
  constructor(private readonly getSettings: () => LiveLLMSettings) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const { provider, apiKey, model } = this.getSettings()
    const active = createLLMProvider({ provider, apiKey, model })
    return active.chat(messages)
  }
}
