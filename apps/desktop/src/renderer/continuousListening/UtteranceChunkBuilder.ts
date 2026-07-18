import { chunkBuilderTuning } from './tuning'
import type { ChunkCompletionReason, UtteranceChunk } from './types'

export interface ChunkBuilderOptions {
  pauseCompletionMs: number
  hardTimeoutMs: number
  maxCharacters: number
  minimumCharacters: number
  now?: () => number
}

const normalizeText = (text: string): string => text.trim().replace(/\s+/g, ' ')
const duplicateKey = (text: string): string => normalizeText(text).toLocaleLowerCase('ru-RU')

export class UtteranceChunkBuilder {
  private partial = ''
  private startedAt: number | null = null
  private lastUpdatedAt: number | null = null
  private sequence = 0
  private readonly completedKeys: Array<{ key: string; completedAt: number }> = []
  private readonly options: ChunkBuilderOptions
  private readonly now: () => number

  constructor(options: Partial<ChunkBuilderOptions> = {}) {
    this.options = { ...chunkBuilderTuning, ...options }
    this.now = options.now ?? Date.now
  }

  speechStarted(): void {
    const now = this.now()
    this.startedAt ??= now
    this.lastUpdatedAt = now
  }

  pushPartial(text: string): UtteranceChunk | null {
    const normalized = normalizeText(text)
    if (!normalized) return null
    const now = this.now()
    this.startedAt ??= now
    this.lastUpdatedAt = now
    // ASR partials are snapshots, not append-only fragments.
    this.partial = normalized.slice(0, this.options.maxCharacters)
    if (normalized.length >= this.options.maxCharacters)
      return this.complete('max_length', undefined, now)
    return null
  }

  pushFinal(
    text: string,
    confidence?: number,
    metadata: Pick<
      UtteranceChunk,
      'streamingSessionId' | 'segmentId' | 'capturedDuringPlayback' | 'triggeredBargeIn'
    > = {},
  ): UtteranceChunk | null {
    const normalized = normalizeText(text)
    if (!normalized) {
      this.reset()
      return null
    }
    const now = this.now()
    this.startedAt ??= now
    this.lastUpdatedAt = now
    this.partial = normalized.slice(0, this.options.maxCharacters)
    return this.complete(
      normalized.length >= this.options.maxCharacters ? 'max_length' : 'asr_final',
      confidence,
      now,
      metadata,
    )
  }

  speechEnded(): UtteranceChunk | null {
    return this.complete('vad_pause')
  }

  poll(): UtteranceChunk | null {
    if (!this.partial || this.lastUpdatedAt === null || this.startedAt === null) return null
    const now = this.now()
    if (now - this.startedAt >= this.options.hardTimeoutMs)
      return this.complete('timeout', undefined, now)
    if (now - this.lastUpdatedAt >= this.options.pauseCompletionMs)
      return this.complete('vad_pause', undefined, now)
    return null
  }

  private complete(
    reason: ChunkCompletionReason,
    confidence?: number,
    completedAt = this.now(),
    metadata: Pick<
      UtteranceChunk,
      'streamingSessionId' | 'segmentId' | 'capturedDuringPlayback' | 'triggeredBargeIn'
    > = {},
  ): UtteranceChunk | null {
    const text = normalizeText(this.partial)
    const startedAt = this.startedAt ?? completedAt
    this.reset()
    if (text.length < this.options.minimumCharacters) return null
    const key =
      metadata.streamingSessionId && metadata.segmentId
        ? `${metadata.streamingSessionId}:${metadata.segmentId}`
        : duplicateKey(text)
    const duplicateWindowMs = 5_000
    if (
      this.completedKeys.some(
        (entry) => entry.key === key && completedAt - entry.completedAt <= duplicateWindowMs,
      )
    )
      return null
    this.completedKeys.push({ key, completedAt })
    if (this.completedKeys.length > 32) this.completedKeys.shift()
    return {
      id:
        metadata.streamingSessionId && metadata.segmentId
          ? `${metadata.streamingSessionId}:${metadata.segmentId}`
          : `utterance-${completedAt}-${++this.sequence}`,
      text,
      startedAt,
      completedAt,
      completionReason: reason,
      confidence,
      ...metadata,
    }
  }

  private reset(): void {
    this.partial = ''
    this.startedAt = null
    this.lastUpdatedAt = null
  }
}
