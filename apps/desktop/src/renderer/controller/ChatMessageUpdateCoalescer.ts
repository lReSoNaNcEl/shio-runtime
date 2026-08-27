import type { ChatMsg } from './contracts'

export type ChatMessagePatch = Pick<ChatMsg, 'text'> &
  Partial<Pick<ChatMsg, 'grounding' | 'streaming'>>

interface PendingUpdate {
  patch: ChatMessagePatch
  timer: ReturnType<typeof setTimeout>
}

export class ChatMessageUpdateCoalescer {
  private readonly pending = new Map<string, PendingUpdate>()

  constructor(
    private readonly commit: (id: string, patch: ChatMessagePatch) => void,
    private readonly intervalMs = 20,
  ) {}

  update(id: string, patch: ChatMessagePatch, immediate = false): void {
    if (immediate) {
      this.flush(id, patch)
      return
    }
    const current = this.pending.get(id)
    if (current) {
      current.patch = { ...current.patch, ...patch }
      return
    }
    const timer = setTimeout(() => this.flush(id), this.intervalMs)
    this.pending.set(id, { patch, timer })
  }

  flush(id: string, patch?: ChatMessagePatch): void {
    const current = this.pending.get(id)
    if (current) {
      clearTimeout(current.timer)
      this.pending.delete(id)
    }
    const next = current ? { ...current.patch, ...patch } : patch
    if (next) this.commit(id, next)
  }

  flushAll(patch?: Partial<ChatMessagePatch>): void {
    for (const id of [...this.pending.keys()]) {
      const current = this.pending.get(id)
      if (current) this.flush(id, { ...current.patch, ...patch })
    }
  }

  dispose(): void {
    for (const update of this.pending.values()) clearTimeout(update.timer)
    this.pending.clear()
  }
}
