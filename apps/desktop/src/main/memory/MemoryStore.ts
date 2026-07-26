import type { ChatMessage } from '../llm'

export interface MemoryStore {
  getHistory(sessionId: string): Promise<ChatMessage[]>
  appendTurn(sessionId: string, turn: { user: ChatMessage; assistant: ChatMessage }): Promise<void>
  clear(sessionId: string): Promise<void>
}
