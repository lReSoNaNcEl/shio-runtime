import type { AvatarBehaviorId } from './AvatarBehaviorResolver'
import type { AvatarMode } from './AvatarStateMachine'

export interface AvatarAnimationQueueItem {
  id: number
  animationId: string
  behaviorId: AvatarBehaviorId | string
  mode: AvatarMode
  loop: boolean
  enqueueTime: number
  interruptible: boolean
}

export interface AvatarAnimationQueueDecision {
  action: 'play' | 'queue' | 'discard' | 'ignored'
  item: AvatarAnimationQueueItem
  interruptedItem: AvatarAnimationQueueItem | null
  reason: string
}

export interface AvatarAnimationQueueDebugState {
  current: AvatarAnimationQueueItem | null
  next: AvatarAnimationQueueItem | null
  items: AvatarAnimationQueueItem[]
  length: number
}

export class AvatarAnimationQueue {
  private current: AvatarAnimationQueueItem | null = null
  private items: AvatarAnimationQueueItem[] = []
  private seq = 0

  request(
    input: Omit<AvatarAnimationQueueItem, 'id' | 'enqueueTime'>,
  ): AvatarAnimationQueueDecision {
    const item: AvatarAnimationQueueItem = {
      ...input,
      id: ++this.seq,
      enqueueTime: Date.now(),
    }

    this.removeObsoleteEntries(item.mode)

    if (!this.current) {
      this.current = item
      return { action: 'play', item, interruptedItem: null, reason: 'no current item' }
    }

    if (this.isDuplicate(this.current, item)) {
      return { action: 'ignored', item, interruptedItem: null, reason: 'already current' }
    }

    if (this.shouldInterrupt(this.current, item)) {
      const interruptedItem = this.current
      this.current = item
      return { action: 'play', item, interruptedItem, reason: 'interrupt current' }
    }

    if (this.shouldQueue(item)) {
      if (this.items.some((queued) => this.isDuplicate(queued, item))) {
        return { action: 'ignored', item, interruptedItem: null, reason: 'already queued' }
      }
      this.items.push(item)
      return { action: 'queue', item, interruptedItem: null, reason: 'queued idle item' }
    }

    return {
      action: 'discard',
      item,
      interruptedItem: null,
      reason: 'not interruptible or queueable',
    }
  }

  completeCurrent(): AvatarAnimationQueueItem | null {
    this.current = null
    const next = this.items.shift() ?? null
    this.current = next
    return next
  }

  clear(): void {
    this.current = null
    this.items = []
  }

  clearPending(): void {
    this.items = []
  }

  replaceCurrent(input: AvatarAnimationQueueItem): void {
    this.removeObsoleteEntries(input.mode)
    this.current = {
      ...input,
      id: input.id || ++this.seq,
      enqueueTime: input.enqueueTime || Date.now(),
    }
  }

  getCurrent(): AvatarAnimationQueueItem | null {
    return this.current
  }

  getDebugState(): AvatarAnimationQueueDebugState {
    return {
      current: this.current,
      next: this.items[0] ?? null,
      items: [...this.items],
      length: this.items.length,
    }
  }

  private shouldInterrupt(
    current: AvatarAnimationQueueItem,
    next: AvatarAnimationQueueItem,
  ): boolean {
    if (current.mode === 'speaking' && next.mode === 'idle') return true
    if (!current.interruptible) return false
    if (next.behaviorId === 'greeting' && current.mode === 'idle') return true
    if (next.mode === 'speaking' && (current.mode === 'idle' || current.behaviorId === 'greeting'))
      return true
    if (next.mode === 'listening' || next.mode === 'thinking') return current.mode === 'idle'
    return next.mode === 'idle' && current.mode === 'idle'
  }

  private isDuplicate(a: AvatarAnimationQueueItem, b: AvatarAnimationQueueItem): boolean {
    return (
      a.animationId === b.animationId &&
      a.behaviorId === b.behaviorId &&
      a.mode === b.mode &&
      a.loop === b.loop
    )
  }

  private shouldQueue(item: AvatarAnimationQueueItem): boolean {
    return (
      item.mode === 'idle' ||
      Boolean(this.current && !this.current.loop && this.current.mode === item.mode)
    )
  }

  private removeObsoleteEntries(nextMode: AvatarMode): void {
    if (nextMode === 'idle') return
    this.items = this.items.filter((item) => item.mode !== 'idle')
  }
}
