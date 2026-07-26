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

  replaceMessages(messages: ChatMsg[]): void {
    this.patch({ messages })
  }

  markLatestAssistantInterrupted(): void {
    const messages = [...this.state.messages]
    const index = messages.findLastIndex((message) => message.role === 'assistant')
    if (index < 0) return
    messages[index] = { ...messages[index], interrupted: true }
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
