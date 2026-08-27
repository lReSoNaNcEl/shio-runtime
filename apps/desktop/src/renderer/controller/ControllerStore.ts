import type { ChatMessagePatch } from './ChatMessageUpdateCoalescer'
import type { ChatMsg, ControllerState } from './contracts'

export type ControllerStateListener = (state: ControllerState) => void

export class ControllerStore {
  private state: ControllerState
  private listeners = new Set<ControllerStateListener>()

  constructor(initialState: ControllerState) {
    this.state = initialState
  }

  subscribe(listener: ControllerStateListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  getState(): ControllerState {
    return this.state
  }

  patch(patch: Partial<ControllerState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  appendMessage(message: ChatMsg): void {
    this.patch({ messages: [...this.state.messages, message] })
  }

  updateMessage(id: string, patch: ChatMessagePatch): void {
    const index = this.state.messages.findIndex((message) => message.id === id)
    if (index < 0) return
    const messages = [...this.state.messages]
    messages[index] = { ...messages[index], ...patch }
    this.patch({ messages })
  }

  replaceMessages(messages: ChatMsg[]): void {
    this.patch({ messages })
  }

  markLatestAssistantInterrupted(): void {
    const messages = [...this.state.messages]
    const index = messages.findLastIndex((message) => message.role === 'assistant')
    if (index < 0) return
    messages[index] = { ...messages[index], interrupted: true, streaming: false }
    this.patch({ messages })
  }

  removeLatestUserMessage(text: string): void {
    const messages = [...this.state.messages]
    const index = messages.findLastIndex(
      (message) => message.role === 'user' && message.text === text,
    )
    if (index < 0) return
    messages.splice(index, 1)
    this.patch({ messages })
  }
}
