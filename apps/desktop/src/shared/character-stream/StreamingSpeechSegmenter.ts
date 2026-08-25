import type { SafeCharacterTextDelta, SpeechSegment } from './contracts'

const MIN_CLAUSE_CHARACTERS = 140
const MAX_SEGMENT_CHARACTERS = 360

export class StreamingSpeechSegmenter {
  private readonly segments: SpeechSegment[] = []
  private buffer = ''
  private emotion = 'neutral'
  private sequence = 0
  private inFence = false
  private inInlineCode = false
  private inLinkDestination = false
  private linkDepth = 0
  private pendingTicks = 0
  private previousSourceCharacter = ''

  constructor(private readonly turnId: string) {}

  push(delta: SafeCharacterTextDelta): readonly SpeechSegment[] {
    this.segments.length = 0
    if (delta.emotion !== this.emotion) {
      this.emitBuffered('clause')
      this.emotion = delta.emotion
    }
    for (const character of delta.text) this.consume(character)
    return Object.freeze([...this.segments])
  }

  flush(): readonly SpeechSegment[] {
    this.segments.length = 0
    this.resolveTicks()
    this.emitBuffered('final')
    return Object.freeze([...this.segments])
  }

  cancel(): void {
    this.buffer = ''
    this.segments.length = 0
    this.pendingTicks = 0
    this.inFence = false
    this.inInlineCode = false
    this.inLinkDestination = false
    this.linkDepth = 0
  }

  private consume(character: string): void {
    if (character === '`') {
      this.pendingTicks += 1
      return
    }
    this.resolveTicks()

    if (!this.inFence && !this.inInlineCode && !this.inLinkDestination) {
      if (character === '(' && this.previousSourceCharacter === ']') {
        this.inLinkDestination = true
        this.linkDepth = 1
        this.previousSourceCharacter = character
        return
      }
    }
    if (this.inLinkDestination) {
      if (character === '(') this.linkDepth += 1
      if (character === ')') {
        this.linkDepth -= 1
        if (this.linkDepth <= 0) this.inLinkDestination = false
      }
      this.previousSourceCharacter = character
      return
    }
    if (this.inFence) {
      this.previousSourceCharacter = character
      return
    }

    this.buffer += character
    this.previousSourceCharacter = character
    if (this.inInlineCode) return

    const trimmed = this.buffer.trimEnd()
    const sentenceBoundary = /(?:[.!?]["')\]]?|…)[\s\n]$/u.test(this.buffer)
    const paragraphBoundary = /\n\s*\n$/u.test(this.buffer)
    const clauseBoundary = trimmed.length >= MIN_CLAUSE_CHARACTERS && /[,;:]$/u.test(trimmed)
    const forcedBoundary = trimmed.length >= MAX_SEGMENT_CHARACTERS && /\s$/u.test(this.buffer)
    if (sentenceBoundary || paragraphBoundary) this.emitBuffered('sentence')
    else if (clauseBoundary || forcedBoundary) this.emitBuffered('clause')
  }

  private resolveTicks(): void {
    if (this.pendingTicks === 0) return
    const triples = Math.floor(this.pendingTicks / 3)
    if (triples > 0) {
      for (let index = 0; index < triples; index += 1) {
        if (!this.inInlineCode) {
          if (!this.inFence) this.emitBuffered('clause')
          this.inFence = !this.inFence
        }
      }
    }
    if (this.pendingTicks % 3 === 1 && !this.inFence) this.inInlineCode = !this.inInlineCode
    this.pendingTicks = 0
  }

  private emitBuffered(boundary: SpeechSegment['boundary']): void {
    const text = this.buffer
      .replace(/^\s*(?:[-*+]\s+|#{1,6}\s+)/gmu, '')
      .replace(/\s+/gu, ' ')
      .trim()
    this.buffer = ''
    if (!/[\p{L}\p{N}]/u.test(text)) return
    this.segments.push(
      Object.freeze({
        id: `${this.turnId}:speech:${this.sequence}`,
        turnId: this.turnId,
        text,
        emotion: this.emotion,
        sequence: this.sequence,
        boundary,
      }),
    )
    this.sequence += 1
  }
}
