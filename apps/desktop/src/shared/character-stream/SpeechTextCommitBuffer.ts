import type { SafeCharacterTextDelta, SpeechTextCommit } from './contracts'

export const SPEECH_COMMIT_MIN_CHARACTERS = 20
export const SPEECH_COMMIT_PREFERRED_CHARACTERS = 48
export const SPEECH_COMMIT_HARD_MAX_CHARACTERS = 200

/**
 * Incrementally commits only stable speakable prose. Markdown code, link
 * destinations and internal protocol markers never cross the speech boundary.
 */
export class SpeechTextCommitBuffer {
  private readonly commits: SpeechTextCommit[] = []
  private buffer = ''
  private emotion = 'neutral'
  private voiceStyle: string | undefined
  private sequence = 0
  private inFence = false
  private inInlineCode = false
  private inLinkDestination = false
  private linkDepth = 0
  private inInternalMarker = false
  private markerTail = ''
  private pendingTicks = 0
  private previousSourceCharacter = ''

  constructor(private readonly turnId: string) {}

  push(delta: SafeCharacterTextDelta): readonly SpeechTextCommit[] {
    this.commits.length = 0
    if (delta.emotion !== this.emotion || delta.voiceStyle !== this.voiceStyle) {
      this.emitBuffered('emotion')
      this.emotion = delta.emotion
      this.voiceStyle = delta.voiceStyle
    }
    for (const character of delta.text) this.consume(character)
    return Object.freeze([...this.commits])
  }

  flush(): readonly SpeechTextCommit[] {
    this.commits.length = 0
    this.resolveTicks()
    this.emitBuffered('final')
    return Object.freeze([...this.commits])
  }

  cancel(): void {
    this.buffer = ''
    this.commits.length = 0
    this.pendingTicks = 0
    this.inFence = false
    this.inInlineCode = false
    this.inLinkDestination = false
    this.inInternalMarker = false
    this.markerTail = ''
    this.linkDepth = 0
  }

  private consume(character: string): void {
    if (this.inInternalMarker) {
      this.markerTail = `${this.markerTail}${character}`.slice(-2)
      if (this.markerTail === '|>') {
        this.inInternalMarker = false
        this.markerTail = ''
      }
      return
    }
    if (character === '<') {
      this.markerTail = '<'
      return
    }
    if (this.markerTail === '<') {
      if (character === '|') {
        this.inInternalMarker = true
        this.markerTail = ''
        return
      }
      this.buffer += '<'
      this.markerTail = ''
    }
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
    if (this.inFence || this.inInlineCode) {
      this.previousSourceCharacter = character
      return
    }

    this.buffer += character
    this.previousSourceCharacter = character
    const trimmed = this.buffer.trimEnd()
    const sentenceBoundary =
      trimmed.length >= SPEECH_COMMIT_MIN_CHARACTERS &&
      /(?:[.!?]["')\]]?|…)[\s\n]$/u.test(this.buffer) &&
      safeSentenceBoundary(trimmed)
    const paragraphBoundary =
      trimmed.length >= SPEECH_COMMIT_MIN_CHARACTERS && /\n\s*\n$/u.test(this.buffer)
    const clauseBoundary =
      trimmed.length >= SPEECH_COMMIT_PREFERRED_CHARACTERS && /[,;:]$/u.test(trimmed)
    if (sentenceBoundary || paragraphBoundary) this.emitBuffered('sentence')
    else if (clauseBoundary) this.emitBuffered('clause')
    else if (trimmed.length >= SPEECH_COMMIT_HARD_MAX_CHARACTERS) this.emitHardLimited()
  }

  private resolveTicks(): void {
    if (this.pendingTicks === 0) return
    const triples = Math.floor(this.pendingTicks / 3)
    for (let index = 0; index < triples; index += 1) {
      if (!this.inInlineCode) {
        if (!this.inFence) this.emitBuffered('clause')
        this.inFence = !this.inFence
      }
    }
    if (this.pendingTicks % 3 === 1 && !this.inFence) this.inInlineCode = !this.inInlineCode
    this.pendingTicks = 0
  }

  private emitHardLimited(): void {
    const safePrefix = this.buffer.slice(0, SPEECH_COMMIT_HARD_MAX_CHARACTERS)
    const splitAt = safePrefix.lastIndexOf(' ')
    const boundary = splitAt >= SPEECH_COMMIT_MIN_CHARACTERS ? splitAt : safePrefix.length
    const remainder = this.buffer.slice(boundary)
    this.buffer = this.buffer.slice(0, boundary)
    this.emitBuffered('hard-limit')
    this.buffer = remainder
  }

  private emitBuffered(boundary: SpeechTextCommit['boundary']): void {
    const text = this.buffer
      .replace(/^\s*(?:[-*+]\s+|#{1,6}\s+)/gmu, '')
      .replace(/<\|[\s\S]*?\|>/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
    this.buffer = ''
    if (!/[\p{L}\p{N}]/u.test(text)) return
    this.commits.push(
      Object.freeze({
        id: `${this.turnId}:speech:${this.sequence}`,
        turnId: this.turnId,
        text,
        emotion: this.emotion,
        ...(this.voiceStyle ? { voiceStyle: this.voiceStyle } : {}),
        sequence: this.sequence,
        boundary,
      }),
    )
    this.sequence += 1
  }
}

function safeSentenceBoundary(text: string): boolean {
  return !/(?:\b(?:e\.g|i\.e|mr|mrs|dr|т\.д|т\.п|г|ул)\.|\b\d+[.,]\d+\.)$/iu.test(text)
}
