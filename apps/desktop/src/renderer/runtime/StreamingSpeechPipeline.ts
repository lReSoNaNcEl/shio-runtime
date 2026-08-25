import type { EmotionTextSegment } from '../../shared/emotion'
import type { PreparedAudio } from '../audio/audioPlayer'
import type { SuccessfulSpeechReply } from './SpeechRuntime'

export interface StreamingPreparedSpeechSegment {
  segment: EmotionTextSegment
  speech: SuccessfulSpeechReply
  audio: PreparedAudio
}

interface StreamingSpeechPipelineOptions {
  turnId: string
  synthesize: (segment: EmotionTextSegment) => Promise<SuccessfulSpeechReply>
  prepareAudio: (audioBuffer: ArrayBuffer) => Promise<PreparedAudio>
  playPrepared: (item: StreamingPreparedSpeechSegment, onStarted: () => void) => Promise<void>
  isCurrentTurn: () => boolean
  recordEvent?: (label: string, detail: string) => void
}

const MAX_PREPARED_AHEAD = 2

/** A bounded, ordered producer/consumer queue fed by safe streamed text deltas. */
export class StreamingSpeechPipeline {
  private readonly pending: EmotionTextSegment[] = []
  private readonly prepared: StreamingPreparedSpeechSegment[] = []
  private cancelled = false
  private closed = false
  private producerDone = false
  private producerError: unknown = null
  private readonly notifications = new Set<() => void>()

  constructor(private readonly options: StreamingSpeechPipelineOptions) {}

  enqueue(segment: EmotionTextSegment): void {
    if (this.cancelled || this.closed) return
    this.pending.push(segment)
    this.record('Streaming Speech Segment Queued', this.detail(segment))
    this.notify()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.notify()
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.pending.length = 0
    this.prepared.length = 0
    this.notify()
    this.record('Streaming Speech Pipeline Cancelled', `turnId=${this.options.turnId}`)
  }

  async execute(): Promise<void> {
    const producer = this.produce()
    try {
      await this.consume()
      this.assertActive()
      this.record('Streaming Speech Pipeline Completed', `turnId=${this.options.turnId}`)
    } catch (error) {
      this.cancel()
      throw error
    } finally {
      await producer
      this.pending.length = 0
      this.prepared.length = 0
    }
  }

  private async produce(): Promise<void> {
    try {
      while (true) {
        this.assertActive()
        while (this.prepared.length >= MAX_PREPARED_AHEAD) await this.wait()
        const segment = this.pending.shift()
        if (!segment) {
          if (this.closed) return
          await this.wait()
          continue
        }
        this.record('Streaming TTS Requested', this.detail(segment))
        const speech = await this.options.synthesize(segment)
        this.assertActive()
        const audio = await this.options.prepareAudio(speech.audioBuffer)
        this.assertActive()
        this.prepared.push({ segment, speech, audio })
        this.record(
          'Streaming Audio Ready',
          `${this.detail(segment)} durationMs=${Math.round(audio.durationMs)}`,
        )
        this.notify()
      }
    } catch (error) {
      if (!this.cancelled) this.producerError = error
    } finally {
      this.producerDone = true
      this.notify()
    }
  }

  private async consume(): Promise<void> {
    while (true) {
      this.assertActive()
      const item = this.prepared.shift()
      if (item) {
        this.notify()
        await this.options.playPrepared(item, () =>
          this.record('Streaming Speech Segment Started', this.detail(item.segment)),
        )
        this.record('Streaming Speech Segment Completed', this.detail(item.segment))
        continue
      }
      if (this.producerError) throw this.producerError
      if (this.producerDone) return
      await this.wait()
    }
  }

  private assertActive(): void {
    if (!this.cancelled && this.options.isCurrentTurn()) return
    this.cancelled = true
    throw new Error(`Streaming speech pipeline cancelled turnId=${this.options.turnId}`)
  }

  private detail(segment: EmotionTextSegment): string {
    return `turnId=${this.options.turnId} segmentIndex=${segment.index} emotion=${segment.emotion}`
  }

  private record(label: string, detail: string): void {
    this.options.recordEvent?.(label, detail)
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => {
      this.notifications.add(resolve)
    })
  }

  private notify(): void {
    const notifications = [...this.notifications]
    this.notifications.clear()
    for (const notification of notifications) notification()
  }
}
