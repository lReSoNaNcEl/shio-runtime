export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Runtime-facing contract. Shio Runtime (Orchestrator) only ever talks to
 * this interface and must never depend on a specific provider.
 */
export interface LLMProvider {
  chat(messages: ChatMessage[]): Promise<string>
}
