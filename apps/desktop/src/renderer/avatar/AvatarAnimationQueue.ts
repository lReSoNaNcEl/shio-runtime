import { getMotionProfile } from '../../shared/motion'
import type { AvatarBehaviorId } from './AvatarBehaviorResolver'
import type { AvatarMode } from './AvatarStateMachine'
import type { AvatarBodyMotionLayer } from './embodiment/motion/AvatarMotionLayer'

export interface AvatarAnimationQueueItem {
  id: number
  animationId: string
  behaviorId: AvatarBehaviorId | string
  mode: AvatarMode
  loop: boolean
  motionLayer: AvatarBodyMotionLayer
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
    forceReplay = false,
  ): AvatarAnimationQueueDecision {
    const item: AvatarAnimationQueueItem = {
      ...input,
      id: ++this.seq,
      enqueueTime: Date.now(),
    }

    this.removeObsoleteEntries(item.mode)
    this.pruneExpired()

    if (!this.current) {
      this.current = item
      return { action: 'play', item, interruptedItem: null, reason: 'no current item' }
    }

    if (!forceReplay && this.isDuplicate(this.current, item)) {
      return { action: 'ignored', item, interruptedItem: null, reason: 'already current' }
    }

    if (forceReplay || this.shouldInterrupt(this.current, item)) {
      const interruptedItem = this.current
      this.current = item
      return { action: 'play', item, interruptedItem, reason: 'interrupt current' }
    }

    if (this.shouldQueue(item)) {
      if (this.items.some((queued) => this.isDuplicate(queued, item))) {
        return { action: 'ignored', item, interruptedItem: null, reason: 'already queued' }
      }
      const family = getMotionProfile(item.animationId)?.family
      if (family)
        this.items = this.items.filter(
          (queued) => getMotionProfile(queued.animationId)?.family !== family,
        )
      if (this.items.length >= 2)
        return { action: 'discard', item, interruptedItem: null, reason: 'pending intent limit' }
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
    this.pruneExpired()
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

  private pruneExpired(): void {
    const now = Date.now()
    this.items = this.items.filter(
      (item) =>
        now - item.enqueueTime <=
        (getMotionProfile(item.animationId)?.variationPolicy.intentTtlMs ?? 5000),
    )
  }

  private shouldInterrupt(
    current: AvatarAnimationQueueItem,
    next: AvatarAnimationQueueItem,
  ): boolean {
    // Admission changes the conversational mode immediately. The common body
    // executor still owns the protected phase and the physical recovery route.
    if (next.mode !== current.mode) return true
    return current.interruptible
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
