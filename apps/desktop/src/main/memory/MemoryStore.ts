import type { ChatMessage } from '../llm'

export interface MemoryStore {
  getHistory(sessionId: string): Promise<ChatMessage[]>
  append(sessionId: string, msg: ChatMessage): Promise<void>
  clear(sessionId: string): Promise<void>
}
