import type { EmotionTextSegment } from '../../shared/emotion'
import type { PreparedAudio } from '../audio/audioPlayer'
import type { SuccessfulSpeechReply } from './SpeechRuntime'

const SYNTHESIS_WORKERS = 2
const MAX_PREPARED_AHEAD = 2

export interface StreamingPreparedSpeechSegment {
  segment: EmotionTextSegment
  speech: SuccessfulSpeechReply
  audio: PreparedAudio
  workerId: string
}

export interface StreamingSpeechTimingEvent {
  name:
    | 'tts_queue_entered'
    | 'tts_execution_started'
    | 'tts_execution_completed'
    | 'audio_preparation_started'
    | 'audio_preparation_completed'
    | 'audio_ready'
    | 'playback_started'
  at: number
  segment: EmotionTextSegment
  workerId: string
}

interface QueuedSegment {
  segment: EmotionTextSegment
  queuedAt: number
}

interface StreamingSpeechPipelineOptions {
  turnId: string
  synthesize: (
    segment: EmotionTextSegment,
    signal: AbortSignal,
    workerId: string,
  ) => Promise<SuccessfulSpeechReply>
  prepareAudio: (audioBuffer: ArrayBuffer) => Promise<PreparedAudio>
  playPrepared: (item: StreamingPreparedSpeechSegment, onStarted: () => void) => Promise<void>
  isCurrentTurn: () => boolean
  recordEvent?: (label: string, detail: string) => void
  recordTiming?: (event: StreamingSpeechTimingEvent) => void
}

/** Two bounded synthesis workers with a sequence-indexed ordered playback buffer. */
export class StreamingSpeechPipeline {
  private readonly pending: QueuedSegment[] = []
  private readonly prepared = new Map<number, StreamingPreparedSpeechSegment>()
  private readonly abortController = new AbortController()
  private cancelled = false
  private closed = false
  private workersDone = 0
  private inFlight = 0
  private producerError: unknown = null
  private nextPlaybackSequence = 0
  private readonly notifications = new Set<() => void>()

  constructor(private readonly options: StreamingSpeechPipelineOptions) {}

  enqueue(segment: EmotionTextSegment): void {
    if (this.cancelled || this.closed) return
    const queuedAt = Date.now()
    this.pending.push({ segment, queuedAt })
    this.timing('tts_queue_entered', segment, 'queued', queuedAt)
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
    this.abortController.abort(
      new Error(`Streaming speech cancelled turnId=${this.options.turnId}`),
    )
    this.pending.length = 0
    this.prepared.clear()
    this.notify()
    this.record('Streaming Speech Pipeline Cancelled', `turnId=${this.options.turnId}`)
  }

  async execute(): Promise<void> {
    const workers = Array.from({ length: SYNTHESIS_WORKERS }, (_, index) =>
      this.work(`worker-${index}`),
    )
    try {
      await this.consume()
      this.assertActive()
      this.record('Streaming Speech Pipeline Completed', `turnId=${this.options.turnId}`)
    } catch (error) {
      this.cancel()
      throw error
    } finally {
      await Promise.all(workers)
      this.pending.length = 0
      this.prepared.clear()
    }
  }

  private async work(workerId: string): Promise<void> {
    try {
      while (true) {
        this.assertActive()
        while (this.prepared.size + this.inFlight >= MAX_PREPARED_AHEAD) await this.wait()
        const queued = this.pending.shift()
        if (!queued) {
          if (this.closed) return
          await this.wait()
          continue
        }
        this.inFlight += 1
        try {
          const { segment } = queued
          this.timing('tts_execution_started', segment, workerId)
          this.record('Streaming TTS Requested', `${this.detail(segment)} workerId=${workerId}`)
          const speech = await this.options.synthesize(
            segment,
            this.abortController.signal,
            workerId,
          )
          this.assertActive()
          this.timing('tts_execution_completed', segment, workerId)
          this.timing('audio_preparation_started', segment, workerId)
          const audio = await this.options.prepareAudio(speech.audioBuffer)
          this.assertActive()
          this.timing('audio_preparation_completed', segment, workerId)
          this.prepared.set(segment.index, { segment, speech, audio, workerId })
          this.timing('audio_ready', segment, workerId)
          this.record(
            'Streaming Audio Ready',
            `${this.detail(segment)} workerId=${workerId} durationMs=${Math.round(audio.durationMs)}`,
          )
        } finally {
          this.inFlight -= 1
          this.notify()
        }
      }
    } catch (error) {
      if (!this.cancelled && this.producerError === null) {
        this.producerError = error
        this.abortController.abort(error)
      }
    } finally {
      this.workersDone += 1
      this.notify()
    }
  }

  private async consume(): Promise<void> {
    while (true) {
      this.assertActive()
      const item = this.prepared.get(this.nextPlaybackSequence)
      if (item) {
        this.prepared.delete(this.nextPlaybackSequence)
        this.nextPlaybackSequence += 1
        this.notify()
        await this.options.playPrepared(item, () => {
          this.timing('playback_started', item.segment, item.workerId)
          this.record(
            'Streaming Speech Segment Started',
            `${this.detail(item.segment)} workerId=${item.workerId}`,
          )
        })
        this.record('Streaming Speech Segment Completed', this.detail(item.segment))
        continue
      }
      if (this.producerError) throw this.producerError
      if (this.workersDone === SYNTHESIS_WORKERS) return
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

  private timing(
    name: StreamingSpeechTimingEvent['name'],
    segment: EmotionTextSegment,
    workerId: string,
    at = Date.now(),
  ): void {
    this.options.recordTiming?.({ name, at, segment, workerId })
  }

  private record(label: string, detail: string): void {
    this.options.recordEvent?.(label, detail)
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => this.notifications.add(resolve))
  }

  private notify(): void {
    const notifications = [...this.notifications]
    this.notifications.clear()
    for (const notification of notifications) notification()
  }
}
