import { backlogTuning } from './tuning'
import type { BufferedUtterance } from './types'

const priorityRank: Record<BufferedUtterance['priorityClass'], number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }
const normalized = (text: string): string => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU')

export class UtteranceBacklog {
  private items: BufferedUtterance[] = []
  private seenIds = new Set<string>()
  private consumedIds = new Set<string>()
  private recentIds: string[] = []
  private version = 0

  getVersion(): number { return this.version }
  size(): number { return this.items.length }
  snapshot(): readonly BufferedUtterance[] { return this.items.map((item) => ({ ...item })) }
  has(id: string): boolean { return this.items.some((item) => item.id === id) }

  enqueue(item: BufferedUtterance, now = Date.now()): boolean {
    if (this.seenIds.has(item.id) || this.consumedIds.has(item.id) || item.likelySelfEcho) return false
    this.rememberId(item.id, this.seenIds)
    this.purge(now)
    if ((item.priorityClass === 'P3' || item.priorityClass === 'P4') &&
      this.items.some((entry) => entry.priorityClass === 'P0' || entry.priorityClass === 'P1')) return false
    const duplicate = this.items.find((entry) => normalized(entry.text) === normalized(item.text))
    if (duplicate) {
      if (item.createdAt > duplicate.createdAt) this.replace(duplicate.id, item)
      return false
    }
    this.items.push({ ...item })
    this.bump()
    this.trimOverflow()
    return true
  }

  purge(now = Date.now()): void {
    const next = this.items.filter((item) => item.expiresAt > now && !item.likelySelfEcho)
    if (next.length !== this.items.length) {
      this.items = next
      this.bump()
    }
  }

  consume(ids: readonly string[], expectedVersion: number): boolean {
    if (expectedVersion !== this.version || ids.length === 0 || ids.some((id) => !this.has(id))) return false
    const selected = new Set(ids)
    this.items = this.items.filter((item) => !selected.has(item.id))
    for (const id of ids) this.rememberId(id, this.consumedIds)
    this.bump()
    return true
  }

  discardWeak(now = Date.now()): void {
    const next = this.items.filter((item) => item.expiresAt > now && (item.priorityClass === 'P0' || item.priorityClass === 'P1'))
    if (next.length !== this.items.length) {
      this.items = next
      this.bump()
    }
  }

  clear(): void {
    if (this.items.length === 0) return
    this.items = []
    this.bump()
  }

  private replace(id: string, item: BufferedUtterance): void {
    this.items = this.items.map((entry) => entry.id === id ? { ...item } : entry)
    this.bump()
  }

  private trimOverflow(): void {
    while (this.items.length > backlogTuning.maxItems) {
      let worst = 0
      for (let index = 1; index < this.items.length; index += 1) {
        const candidate = this.items[index]
        const current = this.items[worst]
        if (priorityRank[candidate.priorityClass] > priorityRank[current.priorityClass] ||
          (candidate.priorityClass === current.priorityClass && candidate.createdAt < current.createdAt)) worst = index
      }
      this.items.splice(worst, 1)
      this.bump()
    }
  }

  private rememberId(id: string, target: Set<string>): void {
    target.add(id)
    this.recentIds.push(id)
    while (this.recentIds.length > backlogTuning.recentIdLimit) {
      const oldest = this.recentIds.shift()
      if (oldest) {
        this.seenIds.delete(oldest)
        this.consumedIds.delete(oldest)
      }
    }
  }

  private bump(): void { this.version += 1 }
}
