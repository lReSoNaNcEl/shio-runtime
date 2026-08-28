import { InternalReasoningStreamContainment } from '../character-response/reasoning'
import { emotionRegistry } from '../emotion'
import type { SafeCharacterTextDelta } from './contracts'

const INTERNAL_MARKERS = ['tools', 'action', 'memory', 'embodiment'] as const
const START_TAGS = INTERNAL_MARKERS.map((name) => `<shio-${name}>`)
const SUPPORTED_EMOTIONS = new Set(emotionRegistry.supported())

function emotionKey(value: string): string {
  return value.toLowerCase().trim().replace(/[ -]+/gu, '_')
}

export class SafeCharacterStreamFilter {
  private readonly reasoning = new InternalReasoningStreamContainment()
  private pending = ''
  private internalMarker: (typeof INTERNAL_MARKERS)[number] | null = null
  private emotion = emotionRegistry.defaultEmotion

  push(text: string): readonly SafeCharacterTextDelta[] {
    if (!text) return []
    this.pending += this.reasoning.push(text).join('')
    return this.drain(false)
  }

  flush(): readonly SafeCharacterTextDelta[] {
    this.pending += this.reasoning.flush().join('')
    return this.drain(true)
  }

  currentEmotion(): string {
    return this.emotion
  }

  private drain(final: boolean): readonly SafeCharacterTextDelta[] {
    const output: SafeCharacterTextDelta[] = []
    while (this.pending) {
      if (this.internalMarker) {
        const closing = `</shio-${this.internalMarker}>`
        const index = this.pending.toLowerCase().indexOf(closing)
        if (index < 0) {
          if (final) this.pending = ''
          else this.pending = this.pending.slice(-(closing.length - 1))
          break
        }
        this.pending = this.pending.slice(index + closing.length)
        this.internalMarker = null
        continue
      }

      const special = this.nextSpecialToken()
      if (special) {
        this.emit(output, this.pending.slice(0, special.index))
        this.pending = this.pending.slice(special.index + special.length)
        if (special.kind === 'marker') this.internalMarker = special.name
        else this.emotion = emotionRegistry.normalize(special.emotion)
        continue
      }

      const hold = final ? this.finalUnsafeSuffixLength() : this.possibleTokenSuffixLength()
      const safeLength = this.pending.length - hold
      if (safeLength > 0) {
        this.emit(output, this.pending.slice(0, safeLength))
        this.pending = this.pending.slice(safeLength)
      }
      if (final) this.pending = ''
      break
    }
    return Object.freeze(output)
  }

  private nextSpecialToken():
    | {
        kind: 'marker'
        index: number
        length: number
        name: (typeof INTERNAL_MARKERS)[number]
      }
    | { kind: 'emotion'; index: number; length: number; emotion: string }
    | null {
    const lower = this.pending.toLowerCase()
    let result:
      | {
          kind: 'marker'
          index: number
          length: number
          name: (typeof INTERNAL_MARKERS)[number]
        }
      | { kind: 'emotion'; index: number; length: number; emotion: string }
      | null = null
    for (const name of INTERNAL_MARKERS) {
      const tag = `<shio-${name}>`
      const index = lower.indexOf(tag)
      if (index >= 0 && (!result || index < result.index)) {
        result = { kind: 'marker', index, length: tag.length, name }
      }
    }
    for (const match of this.pending.matchAll(/\[([a-z_ -]{1,32})\]/giu)) {
      const normalized = emotionKey(match[1] ?? '')
      if (!SUPPORTED_EMOTIONS.has(normalized)) continue
      const index = match.index ?? 0
      if (!result || index < result.index) {
        result = { kind: 'emotion', index, length: match[0].length, emotion: normalized }
      }
    }
    return result
  }

  private possibleTokenSuffixLength(): number {
    let hold = 0
    const lower = this.pending.toLowerCase()
    for (const tag of START_TAGS) {
      const maximum = Math.min(tag.length - 1, lower.length)
      for (let length = maximum; length > hold; length -= 1) {
        if (tag.startsWith(lower.slice(-length))) {
          hold = length
          break
        }
      }
    }
    const bracket = this.pending.lastIndexOf('[')
    if (bracket >= 0 && this.pending.length - bracket <= 34) {
      const suffix = this.pending.slice(bracket)
      if (/^\[[a-z_ -]*$/iu.test(suffix)) hold = Math.max(hold, suffix.length)
    }
    return hold
  }

  private finalUnsafeSuffixLength(): number {
    const lower = this.pending.toLowerCase()
    const marker = lower.lastIndexOf('<shio-')
    const bracket = this.pending.lastIndexOf('[')
    const markerHold = marker >= 0 ? this.pending.length - marker : 0
    const bracketSuffix = bracket >= 0 ? this.pending.slice(bracket) : ''
    const bracketHold = /^\[[a-z_ -]*$/iu.test(bracketSuffix) ? bracketSuffix.length : 0
    return Math.max(markerHold, bracketHold)
  }

  private emit(output: SafeCharacterTextDelta[], text: string): void {
    if (!text) return
    const last = output.at(-1)
    if (last?.emotion === this.emotion) {
      last.text += text
      return
    }
    output.push({ text, emotion: this.emotion })
  }
}
