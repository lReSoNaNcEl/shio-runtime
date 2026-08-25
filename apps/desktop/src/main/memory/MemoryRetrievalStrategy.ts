import type { MemoryRecord } from '../../shared/memory'
import type { SemanticMemoryStore } from './SemanticMemoryStore'

export interface MemoryRetrievalStrategy {
  readonly mode?: 'lexical' | 'hybrid'
  search(query: string, limit: number): readonly MemoryRecord[]
}

export interface MemoryEmbeddingAdapter {
  embed(text: string): readonly number[] | null
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
  readonly mode = 'lexical' as const
  constructor(private readonly store: SemanticMemoryStore) {}

  search(query: string, limit: number): readonly MemoryRecord[] {
    const expression = lexicalExpression(query)
    return expression ? this.store.searchLexical(expression, limit) : Object.freeze([])
  }
}

export class HybridMemoryRetrievalStrategy implements MemoryRetrievalStrategy {
  readonly mode: 'lexical' | 'hybrid'

  constructor(
    private readonly store: SemanticMemoryStore,
    private readonly lexical: MemoryRetrievalStrategy,
    private readonly embeddings?: MemoryEmbeddingAdapter,
  ) {
    this.mode = embeddings ? 'hybrid' : 'lexical'
  }

  search(query: string, limit: number): readonly MemoryRecord[] {
    const lexical = this.lexical.search(query, Math.min(50, limit * 3))
    if (!this.embeddings) return Object.freeze(lexical.slice(0, limit))
    let queryVector: readonly number[] | null
    try {
      queryVector = this.embeddings.embed(query)
    } catch {
      return Object.freeze(lexical.slice(0, limit))
    }
    if (!validVector(queryVector)) return Object.freeze(lexical.slice(0, limit))
    const pool = this.store.list(undefined, 50)
    const lexicalRank = new Map(lexical.map((record, index) => [record.id, index]))
    const ranked = pool
      .map((record) => {
        try {
          const vector = this.embeddings?.embed(record.text)
          if (!validVector(vector) || vector.length !== queryVector.length) return null
          const semantic = cosine(queryVector, vector)
          const rank = lexicalRank.get(record.id)
          const lexicalScore = rank === undefined ? 0 : 1 - rank / Math.max(1, lexical.length)
          const ageDays = Math.max(0, Date.now() - Date.parse(record.updatedAt)) / 86_400_000
          const recency = Math.exp(-ageDays / 90)
          const importance = ['decision', 'commitment', 'relationship'].includes(record.kind)
            ? 1
            : 0.6
          const relationship = record.kind === 'relationship' ? 1 : 0
          return {
            record,
            score:
              semantic * 0.52 +
              lexicalScore * 0.28 +
              recency * 0.12 +
              importance * 0.05 +
              relationship * 0.03,
          }
        } catch {
          return null
        }
      })
      .filter((entry): entry is { record: MemoryRecord; score: number } => entry !== null)
      .sort((left, right) => right.score - left.score)
    if (ranked.length === 0) return Object.freeze(lexical.slice(0, limit))
    return Object.freeze(ranked.slice(0, limit).map((entry) => entry.record))
  }
}

function validVector(vector: readonly number[] | null | undefined): vector is readonly number[] {
  return Boolean(
    vector && vector.length > 0 && vector.length <= 4_096 && vector.every(Number.isFinite),
  )
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)))
}
