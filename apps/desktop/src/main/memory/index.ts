import { InMemoryStore } from './InMemoryStore'
import { MemoryPolicy } from './MemoryPolicy'
import {
  HybridMemoryRetrievalStrategy,
  LexicalMemoryRetrievalStrategy,
  type MemoryEmbeddingAdapter,
} from './MemoryRetrievalStrategy'
import { MemoryRuntime } from './MemoryRuntime'
import type { MemoryStore } from './MemoryStore'
import { SqliteSemanticMemoryStore } from './SemanticMemoryStore'

export function createMemoryStore(_config?: unknown): MemoryStore {
  return new InMemoryStore()
}

export function createSemanticMemoryRuntime(
  databasePath: string,
  options: { embeddings?: MemoryEmbeddingAdapter } = {},
): MemoryRuntime {
  try {
    const store = new SqliteSemanticMemoryStore(databasePath)
    const lexical = new LexicalMemoryRetrievalStrategy(store)
    return new MemoryRuntime(
      store,
      new HybridMemoryRetrievalStrategy(store, lexical, options.embeddings),
      new MemoryPolicy(),
    )
  } catch {
    return new MemoryRuntime(null, null, new MemoryPolicy())
  }
}

export { containsSensitiveMemoryContent, MemoryPolicy, MemoryPolicyError } from './MemoryPolicy'
export type { MemoryEmbeddingAdapter, MemoryRetrievalStrategy } from './MemoryRetrievalStrategy'
export {
  HybridMemoryRetrievalStrategy,
  LexicalMemoryRetrievalStrategy,
} from './MemoryRetrievalStrategy'
export type { MemoryToolExecutionContext } from './MemoryRuntime'
export { MemoryRuntime } from './MemoryRuntime'
export type { MemoryStore } from './MemoryStore'
export { MEMORY_LLM_TOOLS, MemoryToolBroker } from './MemoryToolBroker'
export type { SemanticMemoryStore } from './SemanticMemoryStore'
export { SqliteSemanticMemoryStore } from './SemanticMemoryStore'
