import type { MemoryStore } from './MemoryStore'
import { InMemoryStore } from './InMemoryStore'

export function createMemoryStore(_config?: unknown): MemoryStore {
  return new InMemoryStore()
}

export type { MemoryStore } from './MemoryStore'
