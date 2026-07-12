import type { ChatMessage } from '../llm'
import type { MemoryStore } from './MemoryStore'

const MAX_MESSAGES = 20

export class InMemoryStore implements MemoryStore {
  private sessions = new Map<string, ChatMessage[]>()

  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    return this.sessions.get(sessionId) ?? []
  }

  async append(sessionId: string, msg: ChatMessage): Promise<void> {
    const history = this.sessions.get(sessionId) ?? []
    history.push(msg)
    if (history.length > MAX_MESSAGES) {
      history.splice(0, history.length - MAX_MESSAGES)
    }
    this.sessions.set(sessionId, history)
  }

  async clear(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
  }
}
