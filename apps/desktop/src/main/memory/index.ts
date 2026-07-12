import { InMemoryStore } from './InMemoryStore'
import type { MemoryStore } from './MemoryStore'

export function createMemoryStore(_config?: unknown): MemoryStore {
  return new InMemoryStore()
}

export type { MemoryStore } from './MemoryStore'
