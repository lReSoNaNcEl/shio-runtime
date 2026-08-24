import type { MemoryRecord } from '../../shared/memory'
import type { SemanticMemoryStore } from './SemanticMemoryStore'

export interface MemoryRetrievalStrategy {
  search(query: string, limit: number): readonly MemoryRecord[]
}

const SEARCH_TERM_LIMIT = 16

function lexicalExpression(query: string): string | null {
  const terms = query
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu)
  if (!terms) return null
  const unique = [...new Set(terms)].slice(0, SEARCH_TERM_LIMIT)
  return unique.length > 0
    ? unique.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ')
    : null
}

export class LexicalMemoryRetrievalStrategy implements MemoryRetrievalStrategy {
  constructor(private readonly store: SemanticMemoryStore) {}

  search(query: string, limit: number): readonly MemoryRecord[] {
    const expression = lexicalExpression(query)
    return expression ? this.store.searchLexical(expression, limit) : Object.freeze([])
  }
}
