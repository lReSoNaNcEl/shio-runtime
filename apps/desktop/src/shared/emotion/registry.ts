import emotionManifest from '../../../emotion_manifest.json'
import type { EmotionContract, EmotionManifest, EmotionManifestEntry } from './contracts'

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export class EmotionRegistry {
  readonly schemaVersion: number
  readonly defaultEmotion: string

  private entries = new Map<string, EmotionManifestEntry>()
  private aliases = new Map<string, string>()
  private markerPatterns: Array<{ pattern: RegExp; emotion: string | null }> = []

  constructor(private manifest: EmotionManifest) {
    this.schemaVersion = manifest.schemaVersion
    this.defaultEmotion = normalizeKey(manifest.defaultEmotion || 'neutral')
    this.load()
  }

  supported(): string[] {
    return Array.from(this.entries.keys())
  }

  normalize(tag?: string): string {
    const raw = normalizeKey(tag || this.defaultEmotion)
    const resolved = this.aliases.get(raw)
    if (resolved) return resolved
    if (raw !== this.defaultEmotion)
      console.warn(`[emotion] Unknown emotion tag "${raw}", using ${this.defaultEmotion}`)
    return this.defaultEmotion
  }

  parseLeadingEmotionTag(text: string): string {
    const leading = /^\s*\[([a-z_ -]+)\]/i.exec(text)
    if (leading) return this.normalize(leading[1])

    const trailing = /\[([a-z_ -]+)\]\s*$/i.exec(text)
    return this.normalize(trailing?.[1])
  }

  stripEmotionTags(text: string): string {
    let result = text
    for (const { pattern } of this.markerPatterns) {
      result = result.replace(pattern, ' ')
    }
    return result.replace(/\s+/g, ' ').trim()
  }

  avatarBehavior(emotion: string): string {
    return this.entries.get(this.normalize(emotion))?.avatar?.behavior ?? this.defaultEmotion
  }

  avatarBodyIntent(emotion: string): string {
    return this.entries.get(this.normalize(emotion))?.avatar?.bodyIntent ?? 'explain'
  }

  avatarExpression(emotion: string): string {
    return this.entries.get(this.normalize(emotion))?.avatar?.expression ?? this.defaultEmotion
  }

  avatarExpressionWeights(emotion: string): Record<string, number> {
    return { ...(this.entries.get(this.normalize(emotion))?.avatar?.expressionWeights ?? {}) }
  }

  promptList(): string {
    return this.supported()
      .map((emotion) => `[${emotion}]`)
      .join(', ')
  }

  contract(): EmotionContract {
    return {
      schemaVersion: this.schemaVersion,
      defaultEmotion: this.defaultEmotion,
      supported: this.supported(),
    }
  }

  hasDrift(remote: EmotionContract): boolean {
    return (
      remote.schemaVersion !== this.schemaVersion ||
      remote.defaultEmotion !== this.defaultEmotion ||
      remote.supported.join('|') !== this.supported().join('|')
    )
  }

  private load(): void {
    for (const raw of this.manifest.emotions) {
      const id = normalizeKey(raw.id)
      if (this.entries.has(id)) throw new Error(`Duplicate emotion id: ${id}`)
      const entry: EmotionManifestEntry = { ...raw, id }
      this.entries.set(id, entry)
      this.aliases.set(id, id)
      for (const alias of raw.aliases ?? []) this.aliases.set(normalizeKey(alias), id)
      for (const marker of raw.markers ?? []) {
        this.markerPatterns.push({
          pattern: new RegExp(`\\s*${escapeRegExp(marker)}\\s*`, 'gi'),
          emotion: id,
        })
      }
    }

    if (!this.entries.has(this.defaultEmotion))
      throw new Error(`defaultEmotion is missing: ${this.defaultEmotion}`)

    const known = Array.from(this.aliases.keys()).sort((a, b) => b.length - a.length)
    const dynamic = known.map((key) => escapeRegExp(key).replace(/_/g, '[_ -]?')).join('|')
    this.markerPatterns.push({
      pattern: new RegExp(`\\s*[\\[(](${dynamic})[\\])]\\s*`, 'gi'),
      emotion: null,
    })
  }
}

export const emotionRegistry = new EmotionRegistry(emotionManifest as unknown as EmotionManifest)
export const SUPPORTED_EMOTIONS = emotionRegistry.supported()
