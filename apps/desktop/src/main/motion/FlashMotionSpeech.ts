import type { SpeechStreamOutput, SpeechStreamStart } from '../../shared/speech'

const SAMPLE_RATE = 44_100
const MAX_BUFFER_SAMPLES = SAMPLE_RATE * 5
const SOURCE_STEP = SAMPLE_RATE / 30
const MAX_CONTEXT = SOURCE_STEP * 24
const MAX_FOLLOWING_CONTEXT = SOURCE_STEP * 8
type Audio = Extract<SpeechStreamOutput, { type: 'audio' }>

/** A bounded copy of the validated Fish stream for the current motion request. */
export class FlashMotionSpeech {
  private enabled = true

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.clear()
  }
  private turn: SpeechStreamStart | null = null
  private audio: Audio[] = []
  private text = new Map<number, string>()
  private expiry: ReturnType<typeof setTimeout> | undefined

  start(turn: SpeechStreamStart): void {
    this.clear()
    if (!this.enabled) return
    this.turn = turn
  }

  addText(turnId: string, sequence: number, text: string): void {
    if (turnId !== this.turn?.turnId) return
    this.text.set(sequence, text)
    if (this.text.size > 32) {
      const first = this.text.keys().next().value
      if (first !== undefined) this.text.delete(first)
    }
  }

  addAudio(event: Audio): void {
    if (this.turn?.turnId !== event.turnId || this.turn.sessionId !== event.sessionId) return
    const last = this.audio.at(-1)
    if (last && last.sampleOffset + last.samples !== event.sampleOffset) {
      this.clear(event.turnId)
      return
    }
    this.audio.push(event)
    const threshold = event.sampleOffset + event.samples - MAX_BUFFER_SAMPLES
    while (this.audio.length > 0 && this.audio[0].sampleOffset < threshold) this.audio.shift()
  }

  finish(turnId: string): void {
    if (this.turn?.turnId !== turnId) return
    clearTimeout(this.expiry)
    this.expiry = setTimeout(() => this.clear(turnId), 6500)
    this.expiry.unref()
  }

  clear(turnId?: string): void {
    if (turnId && this.turn?.turnId !== turnId) return
    clearTimeout(this.expiry)
    this.expiry = undefined
    this.turn = null
    this.audio = []
    this.text.clear()
  }

  window(playbackId: string, startSample: number) {
    const turn = this.turn
    if (!turn || !this.matches(playbackId)) return undefined
    const first = this.audio[0]
    const last = this.audio.at(-1)
    if (!first || !last || first.sampleOffset > startSample) return undefined
    const end = last.sampleOffset + last.samples
    const frames = Math.min(24, Math.floor((end - startSample) / (SOURCE_STEP * 4)) * 4)
    if (frames < 8) return undefined
    const contextStart =
      startSample -
      Math.min(
        MAX_CONTEXT,
        Math.floor((startSample - first.sampleOffset) / SOURCE_STEP) * SOURCE_STEP,
      )
    const motionEnd = startSample + frames * SOURCE_STEP
    const followingSamples = Math.min(
      MAX_FOLLOWING_CONTEXT,
      Math.floor((end - motionEnd) / SOURCE_STEP) * SOURCE_STEP,
    )
    const contextEnd = motionEnd + followingSamples
    const pcm: Buffer[] = []
    const sequences = new Set<number>()
    for (const event of this.audio) {
      const from = Math.max(contextStart, event.sampleOffset)
      const to = Math.min(contextEnd, event.sampleOffset + event.samples)
      if (to <= from) continue
      pcm.push(Buffer.from(event.pcm, (from - event.sampleOffset) * 4, (to - from) * 4))
      if (event.textSequence !== undefined) sequences.add(event.textSequence)
    }
    if (pcm.reduce((count, chunk) => count + chunk.length, 0) !== (contextEnd - contextStart) * 4)
      return undefined
    const words = [...sequences]
      .flatMap((sequence) => [
        this.text.get(sequence - 2),
        this.text.get(sequence - 1),
        this.text.get(sequence),
        this.text.get(sequence + 1),
      ])
      .filter((value): value is string => Boolean(value))
    return {
      playbackId,
      startSample,
      frames,
      contextSamples: startSample - contextStart,
      followingSamples,
      language: turn.language,
      text: [...new Set(words)].join(' ').slice(0, 1200),
      pcm: Buffer.concat(pcm).toString('base64'),
    }
  }

  matches(playbackId: string): boolean {
    const split = playbackId.lastIndexOf(':playback-')
    return (
      split > 0 &&
      playbackId.slice(0, split) === this.turn?.turnId &&
      /^[0-9]+$/u.test(playbackId.slice(split + ':playback-'.length))
    )
  }
}
