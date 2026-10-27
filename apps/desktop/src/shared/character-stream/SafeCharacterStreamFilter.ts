import {
  EMBODIMENT_ENVELOPE_MAX_CHARACTERS,
  EMBODIMENT_GESTURE_HINTS,
  parseEarlyEmbodimentEnvelope,
} from '../character-response/embodiment'
import { InternalReasoningStreamContainment } from '../character-response/reasoning'
import { emotionRegistry } from '../emotion/registry'
import { normalizeVoiceStyle, VOICE_STYLE_MAX_LENGTH } from '../speech/voiceStyle'
import type { SafeCharacterTextDelta, SafeEmbodimentIntent } from './contracts'
import { initialMarkdownProtocolState, scanMarkdownProtocol } from './MarkdownProtocolScope'

const INTERNAL_MARKERS = ['tools', 'action', 'memory', 'embodiment', 'intent'] as const
const START_TAGS = INTERNAL_MARKERS.flatMap((name) => [`<shio-${name}>`, `</shio-${name}>`])
const PROVIDER_TOOL_MARKERS = ['tool_call', 'tool_calls', 'function_call'] as const
const PROVIDER_TOOL_TOKEN = /\\?<\s*(\/?)\s*(tool\\?_calls?|function\\?_call)\s*>/iu
const PROVIDER_TOOL_CLOSING_TOKEN = /\\?<\s*\/\s*(tool\\?_calls?|function\\?_call)\s*>/giu
const PROVIDER_TOOL_TAGS = PROVIDER_TOOL_MARKERS.flatMap((name) => {
  const escapedName = name.replaceAll('_', '\\_')
  return [`<${name}>`, `\\<${escapedName}>`, `</${name}>`, `\\</${escapedName}>`]
})
const VOICE_STYLE_PREFIX = '[voice:'
const CONTROL_TAG_PREFIXES = [...START_TAGS, ...PROVIDER_TOOL_TAGS, VOICE_STYLE_PREFIX]
const SUPPRESSED_INTERNAL_SUFFIX_LENGTH = 64
const SUPPORTED_EMOTIONS = new Set(emotionRegistry.supported())
const GESTURE_LITERALS: ReadonlySet<string> = new Set(EMBODIMENT_GESTURE_HINTS)

function isKnownBracketControl(value: string): boolean {
  return (
    SUPPORTED_EMOTIONS.has(emotionKey(value)) || GESTURE_LITERALS.has(value.toLowerCase().trim())
  )
}

type ActiveInternalMarker =
  | { kind: 'voice-style'; depth: number }
  | { kind: 'shio'; name: string; acceptsIntent?: boolean }
  | { kind: 'provider-tool'; name: (typeof PROVIDER_TOOL_MARKERS)[number] }

function emotionKey(value: string): string {
  return value.toLowerCase().trim().replace(/[ -]+/gu, '_')
}

export class SafeCharacterStreamFilter {
  private readonly reasoning = new InternalReasoningStreamContainment()
  private pending = ''
  private internalMarker: ActiveInternalMarker | null = null
  private emotion = emotionRegistry.defaultEmotion
  private voiceStyle: string | undefined
  private readonly markdown = initialMarkdownProtocolState()
  private protocolHoldIndex: number | null = null
  private deliveryChanges = 0
  private hasDeliveredText = false
  private pendingCueChanged = false
  private intentPayload = ''
  private intentOverflow = false
  private intentSeen = false
  private readonly intents: SafeEmbodimentIntent[] = []

  takeEmbodimentIntents(): readonly SafeEmbodimentIntent[] {
    return this.intents.splice(0)
  }

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
        const closing = findInternalClosingToken(this.pending, this.internalMarker)
        if (!closing) {
          if (this.internalMarker.kind === 'shio' && this.internalMarker.name === 'intent') {
            if (
              this.pending.length >
              EMBODIMENT_ENVELOPE_MAX_CHARACTERS + SUPPRESSED_INTERNAL_SUFFIX_LENGTH
            ) {
              this.intentOverflow = true
              this.pending = this.pending.slice(-SUPPRESSED_INTERNAL_SUFFIX_LENGTH)
            }
            if (final) this.pending = ''
            break
          }
          if (final) this.pending = ''
          else
            this.pending =
              this.internalMarker.kind === 'voice-style'
                ? ''
                : this.pending.slice(-SUPPRESSED_INTERNAL_SUFFIX_LENGTH)
          break
        }
        if (
          this.internalMarker.kind === 'shio' &&
          this.internalMarker.name === 'intent' &&
          !this.intentSeen
        ) {
          this.intentSeen = true
          this.intentPayload = this.pending.slice(0, closing.index)
          const intent =
            !this.intentOverflow && this.internalMarker.acceptsIntent
              ? parseEarlyEmbodimentEnvelope(this.intentPayload)
              : undefined
          if (intent)
            this.intents.push({ intent, timing: this.hasDeliveredText ? 'late' : 'early' })
          this.intentPayload = ''
        }
        this.pending = this.pending.slice(closing.index + closing.length)
        this.internalMarker = null
        continue
      }

      const special = this.nextSpecialToken(final)
      if (special) {
        this.emit(output, this.pending.slice(0, special.index))
        this.pending = this.pending.slice(special.index + special.length)
        if (special.kind === 'marker') {
          this.internalMarker = special.marker
          this.intentOverflow = false
          if (special.marker?.kind === 'voice-style') this.voiceStyle = undefined
        } else if (special.kind === 'voice-style') this.setDelivery(this.emotion, special.style)
        else this.setDelivery(emotionRegistry.normalize(special.emotion), undefined)
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

  private nextSpecialToken(final: boolean):
    | {
        kind: 'marker'
        index: number
        length: number
        marker: ActiveInternalMarker | null
      }
    | { kind: 'emotion'; index: number; length: number; emotion: string }
    | { kind: 'voice-style'; index: number; length: number; style?: string }
    | null {
    const lower = this.pending.toLowerCase()
    this.protocolHoldIndex = null
    const allowed = scanMarkdownProtocol(this.pending, { ...this.markdown })
    let result:
      | {
          kind: 'marker'
          index: number
          length: number
          marker: ActiveInternalMarker | null
        }
      | { kind: 'emotion'; index: number; length: number; emotion: string }
      | { kind: 'voice-style'; index: number; length: number; style?: string }
      | null = null
    let voiceIndex = lower.indexOf(VOICE_STYLE_PREFIX)
    while (voiceIndex >= 0 && !allowed[voiceIndex])
      voiceIndex = lower.indexOf(VOICE_STYLE_PREFIX, voiceIndex + 1)
    let voiceEnd = -1
    if (voiceIndex >= 0) {
      const end = findVoiceClosing(this.pending, voiceIndex + VOICE_STYLE_PREFIX.length, {
        kind: 'voice-style',
        depth: 0,
      })
      voiceEnd = end
      if (end >= 0 && this.isControlToken(voiceIndex, end + 1, final)) {
        result = {
          kind: 'voice-style',
          index: voiceIndex,
          length: end - voiceIndex + 1,
          style: normalizeVoiceStyle(
            this.pending.slice(voiceIndex + VOICE_STYLE_PREFIX.length, end),
          ),
        }
      } else if (lower.length - voiceIndex > VOICE_STYLE_PREFIX.length + VOICE_STYLE_MAX_LENGTH) {
        // Invalid oversized instructions remain suppressed without growing memory.
        result = {
          kind: 'marker',
          index: voiceIndex,
          length: VOICE_STYLE_PREFIX.length,
          marker: { kind: 'voice-style', depth: 0 },
        }
      } else if (end < 0 && !final) {
        this.protocolHoldIndex = voiceIndex
      }
    }
    const internal = /<(\/?)shio-([a-z][a-z0-9-]*)\b[^>]*>/iu.exec(this.pending)
    if (internal && (!result || internal.index < result.index)) {
      const name = internal[2].toLowerCase()
      result = {
        kind: 'marker',
        index: internal.index,
        length: internal[0].length,
        marker: internal[1]
          ? null
          : {
              kind: 'shio',
              name,
              acceptsIntent:
                Boolean(allowed[internal.index]) && internal[0].toLowerCase() === '<shio-intent>',
            },
      }
    }
    const incompleteInternal = /<(\/?)shio-([a-z][a-z0-9-]*)\b[^>]*$/iu.exec(this.pending)
    if (
      incompleteInternal &&
      this.pending.length - incompleteInternal.index > 128 &&
      (!result || incompleteInternal.index < result.index)
    ) {
      result = {
        kind: 'marker',
        index: incompleteInternal.index,
        length: this.pending.length - incompleteInternal.index,
        marker: incompleteInternal[1]
          ? null
          : {
              kind: 'shio',
              name: incompleteInternal[2].slice(0, 80).toLowerCase(),
              acceptsIntent: false,
            },
      }
    }
    const providerTool = PROVIDER_TOOL_TOKEN.exec(this.pending)
    if (providerTool && (!result || providerTool.index < result.index)) {
      const name = providerToolMarker(providerTool[2] ?? '')
      result = {
        kind: 'marker',
        index: providerTool.index,
        length: providerTool[0].length,
        marker: providerTool[1] ? null : { kind: 'provider-tool', name },
      }
    }
    for (const match of this.pending.matchAll(/<\/?([a-z_ -]{1,32})[\]>]|\[([a-z_ -]{1,32})>/giu)) {
      const index = match.index
      if (!SUPPORTED_EMOTIONS.has(emotionKey(match[1] ?? match[2]))) continue
      if (!allowed[index]) continue
      if (voiceIndex >= 0 && index > voiceIndex && (voiceEnd < 0 || index < voiceEnd)) continue
      if (!result || index < result.index)
        result = { kind: 'marker', index, length: match[0].length, marker: null }
    }
    for (const match of this.pending.matchAll(/\[([a-z_ -]{1,32})\]/giu)) {
      const normalized = emotionKey(match[1] ?? '')
      const gestureLiteral = GESTURE_LITERALS.has((match[1] ?? '').toLowerCase().trim())
      if (!SUPPORTED_EMOTIONS.has(normalized) && !gestureLiteral) continue
      const index = match.index ?? 0
      if (voiceIndex >= 0 && index > voiceIndex && (voiceEnd < 0 || index < voiceEnd)) continue
      if (!allowed[index] || !this.isControlToken(index, index + match[0].length, final)) continue
      if (!result || index < result.index) {
        result = gestureLiteral
          ? { kind: 'marker', index, length: match[0].length, marker: null }
          : { kind: 'emotion', index, length: match[0].length, emotion: normalized }
      }
    }
    return result
  }

  private possibleTokenSuffixLength(): number {
    let hold = this.protocolHoldIndex === null ? 0 : this.pending.length - this.protocolHoldIndex
    const lower = this.pending.toLowerCase()
    const allowed = scanMarkdownProtocol(this.pending, { ...this.markdown })
    for (const tag of CONTROL_TAG_PREFIXES) {
      const maximum = Math.min(tag.length - 1, lower.length)
      for (let length = maximum; length > hold; length -= 1) {
        if (tag.startsWith(lower.slice(-length))) {
          hold = length
          break
        }
      }
    }
    const internalStart = Math.max(lower.lastIndexOf('<shio-'), lower.lastIndexOf('</shio-'))
    if (internalStart >= 0 && !lower.slice(internalStart).includes('>'))
      hold = Math.max(hold, this.pending.length - internalStart)
    const providerStart = lastProviderToolMarkerStart(lower)
    if (providerStart >= 0 && !lower.slice(providerStart).includes('>')) {
      hold = Math.max(hold, this.pending.length - providerStart)
    }
    const bracket = this.pending.lastIndexOf('[')
    const voiceIndex = lower.lastIndexOf(VOICE_STYLE_PREFIX)
    if (voiceIndex >= 0 && allowed[voiceIndex] && !lower.slice(voiceIndex).includes(']')) {
      hold = Math.max(hold, this.pending.length - voiceIndex)
    }
    if (bracket >= 0 && allowed[bracket] && this.pending.length - bracket <= 34) {
      const suffix = this.pending.slice(bracket)
      if (this.isBracketControlPrefix(suffix)) hold = Math.max(hold, suffix.length)
    }
    hold = Math.max(hold, this.angleEmotionSuffixLength(allowed, false))
    const complete = /\[(?:[a-z_ -]{1,32}|voice:[^\]]{0,120})\]$/iu.exec(this.pending)
    if (
      complete &&
      allowed[complete.index] &&
      (complete[0].toLowerCase().startsWith(VOICE_STYLE_PREFIX) ||
        isKnownBracketControl(complete[0].slice(1, -1)))
    )
      hold = Math.max(hold, complete[0].length)
    const ticks = /[`~]+$/u.exec(this.pending)
    if (ticks && ticks[0].length <= 16) hold = Math.max(hold, ticks[0].length)
    return hold
  }

  private finalUnsafeSuffixLength(): number {
    const lower = this.pending.toLowerCase()
    const marker = Math.max(lower.lastIndexOf('<shio-'), lower.lastIndexOf('</shio-'))
    const bracket = this.pending.lastIndexOf('[')
    const markerHold = marker >= 0 ? this.pending.length - marker : 0
    const providerStart = lastProviderToolMarkerStart(lower)
    const providerHold = providerStart >= 0 ? this.pending.length - providerStart : 0
    const voiceIndex = lower.lastIndexOf(VOICE_STYLE_PREFIX)
    const allowed = scanMarkdownProtocol(this.pending, { ...this.markdown })
    const voiceHold = voiceIndex >= 0 && allowed[voiceIndex] ? this.pending.length - voiceIndex : 0
    const bracketSuffix = bracket >= 0 ? this.pending.slice(bracket) : ''
    const bracketHold =
      bracket >= 0 && allowed[bracket] && this.isBracketControlPrefix(bracketSuffix)
        ? bracketSuffix.length
        : 0
    return Math.max(
      markerHold,
      providerHold,
      bracketHold,
      voiceHold,
      this.angleEmotionSuffixLength(allowed, true),
    )
  }

  private angleEmotionSuffixLength(allowed: readonly boolean[], final: boolean): number {
    const suffix = /<\/?([a-z_ -]{0,32})$/iu.exec(this.pending)
    if (!suffix || !allowed[suffix.index]) return 0
    const name = emotionKey(suffix[1])
    const recognized = final
      ? SUPPORTED_EMOTIONS.has(name)
      : [...SUPPORTED_EMOTIONS].some((emotion) => emotion.startsWith(name))
    return recognized ? suffix[0].length : 0
  }

  private emit(output: SafeCharacterTextDelta[], text: string): void {
    if (!text) return
    scanMarkdownProtocol(text, this.markdown)
    if (/\S/u.test(text)) {
      this.hasDeliveredText = true
      this.pendingCueChanged = false
    }
    const last = output.at(-1)
    if (last?.emotion === this.emotion && last.voiceStyle === this.voiceStyle) {
      last.text += text
      return
    }
    output.push({
      text,
      emotion: this.emotion,
      ...(this.voiceStyle ? { voiceStyle: this.voiceStyle } : {}),
    })
  }

  private setDelivery(emotion: string, style: string | undefined): void {
    if (emotion === this.emotion && style === this.voiceStyle) return
    if (this.hasDeliveredText && !this.pendingCueChanged) {
      if (this.deliveryChanges >= 2) return
      this.deliveryChanges += 1
      this.pendingCueChanged = true
    }
    this.emotion = emotion
    this.voiceStyle = style
  }

  private isControlToken(start: number, after: number, final: boolean): boolean {
    if (after === this.pending.length) {
      if (!final)
        this.protocolHoldIndex =
          this.protocolHoldIndex === null ? start : Math.min(start, this.protocolHoldIndex)
      return final
    }
    const next = this.pending[after]
    if (next === '(' || next === ':') return false
    if (next !== '[') return true
    const following = this.pending.slice(after)
    if (following.toLowerCase().startsWith(VOICE_STYLE_PREFIX)) return true
    const complete = /^\[([a-z_ -]{1,32})\]/iu.exec(following)
    if (complete) return isKnownBracketControl(complete[1])
    if (!final && following.length <= 128 && !following.includes(']'))
      this.protocolHoldIndex =
        this.protocolHoldIndex === null ? start : Math.min(start, this.protocolHoldIndex)
    return false
  }

  private isBracketControlPrefix(suffix: string): boolean {
    if (!suffix.startsWith('[') || suffix.includes(']')) return false
    const prefix = emotionKey(suffix.slice(1))
    return (
      [...SUPPORTED_EMOTIONS].some((emotion) => emotion.startsWith(prefix)) ||
      EMBODIMENT_GESTURE_HINTS.some((gesture) => gesture.startsWith(suffix.slice(1).toLowerCase()))
    )
  }
}

function providerToolMarker(value: string): (typeof PROVIDER_TOOL_MARKERS)[number] {
  return value.replaceAll('\\', '').toLowerCase() as (typeof PROVIDER_TOOL_MARKERS)[number]
}

function findInternalClosingToken(
  text: string,
  marker: ActiveInternalMarker,
): { index: number; length: number } | null {
  if (marker.kind === 'voice-style') {
    const index = findVoiceClosing(text, 0, marker)
    return index >= 0 ? { index, length: 1 } : null
  }
  if (marker.kind === 'shio') {
    const closing = `</shio-${marker.name}>`
    const index = text.toLowerCase().indexOf(closing)
    return index >= 0 ? { index, length: closing.length } : null
  }
  for (const match of text.matchAll(PROVIDER_TOOL_CLOSING_TOKEN)) {
    if (providerToolMarker(match[1] ?? '') === marker.name) {
      return { index: match.index, length: match[0].length }
    }
  }
  return null
}

function findVoiceClosing(
  text: string,
  start: number,
  marker: Extract<ActiveInternalMarker, { kind: 'voice-style' }>,
): number {
  if (marker.depth > 32) return -1
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '[') {
      marker.depth += 1
      if (marker.depth > 32) return -1
    } else if (text[index] === ']') {
      if (marker.depth === 0) return index
      marker.depth -= 1
    }
  }
  return -1
}

function lastProviderToolMarkerStart(lower: string): number {
  return Math.max(
    lower.lastIndexOf('<tool'),
    lower.lastIndexOf('\\<tool'),
    lower.lastIndexOf('<function'),
    lower.lastIndexOf('\\<function'),
  )
}
