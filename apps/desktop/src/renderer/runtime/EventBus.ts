import type { EventBus, RuntimeEvent, RuntimeEventInput } from '../../shared/runtime/events'

const MAX_EVENT_HISTORY = 200

export class PassiveEventBus implements EventBus {
  private listeners = new Set<(event: RuntimeEvent) => void>()
  private history: RuntimeEvent[] = []
  private sequence = 0

  publish(input: RuntimeEventInput): RuntimeEvent {
    const event = Object.freeze({
      ...input,
      id: `evt-${++this.sequence}`,
      occurredAt: Date.now(),
      metadata: input.metadata ? Object.freeze({ ...input.metadata }) : undefined,
    })

    this.history = [...this.history, event].slice(-MAX_EVENT_HISTORY)
    for (const listener of this.listeners) listener(event)
    return event
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getHistory(): readonly RuntimeEvent[] {
    return this.history
  }

  clearHistory(): void {
    this.history = []
  }
}
