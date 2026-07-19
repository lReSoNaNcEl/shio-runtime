import type { EmotionTextSegment } from '../../shared/emotion'
import type { PreparedAudio } from '../audio/audioPlayer'
import type { SuccessfulSpeechReply } from './SpeechRuntime'

export const EMOTION_SPEECH_TUNING = {
  initialBufferedAudioMs: 1800,
  maxPreparedAhead: 2,
  maxSegments: 3,
} as const

export interface PreparedEmotionSpeechSegment {
  segment: EmotionTextSegment
  speech: SuccessfulSpeechReply
  audio: PreparedAudio
}

export interface EmotionSpeechPipelineOptions {
  turnId: string
  segments: EmotionTextSegment[]
  synthesize: (segment: EmotionTextSegment) => Promise<SuccessfulSpeechReply>
  prepareAudio: (audioBuffer: ArrayBuffer) => Promise<PreparedAudio>
  playPrepared: (item: PreparedEmotionSpeechSegment, onStarted: () => void) => Promise<void>
  isCurrentTurn: () => boolean
  recordEvent?: (label: string, detail: string) => void
  now?: () => number
}

export class EmotionSpeechPipeline {
  private readonly prepared: Array<PreparedEmotionSpeechSegment | undefined> = []
  private cancelled = false
  private producerDone = false
  private producerError: unknown = null
  private consumerStarted = false
  private notification: (() => void) | null = null
  private cancellationRecorded = false

  constructor(private readonly options: EmotionSpeechPipelineOptions) {}

  async execute(): Promise<void> {
    const segments = this.options.segments.slice(0, EMOTION_SPEECH_TUNING.maxSegments)
    this.record('Emotion Speech Plan Created', `turnId=${this.options.turnId}`)
    const producer = this.produce(segments)
    try {
      await this.consume(segments)
      this.assertActive()
      this.record('Emotion Speech Pipeline Completed', `turnId=${this.options.turnId}`)
    } finally {
      await producer
      this.prepared.length = 0
    }
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.prepared.length = 0
    this.notify()
    this.recordCancellation()
  }

  private async produce(segments: EmotionTextSegment[]): Promise<void> {
    try {
      for (const segment of segments) {
        this.assertActive()
        await this.waitForCapacity()
        this.assertActive()
        this.record(
          'Emotion Speech Segment Synthesis Started',
          this.segmentDetail(segment, this.preparedCount()),
        )
        const speech = await this.options.synthesize(segment)
        this.assertActive()
        const audio = await this.options.prepareAudio(speech.audioBuffer)
        this.assertActive()
        this.prepared[segment.index] = { segment, speech, audio }
        this.record(
          'Emotion Speech Segment Prepared',
          `${this.segmentDetail(segment, this.preparedCount())} durationMs=${Math.round(audio.durationMs)}`,
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

  private async consume(segments: EmotionTextSegment[]): Promise<void> {
    await this.waitForInitialBuffer(segments)
    this.consumerStarted = true
    this.notify()
    let previousCompletedAt: number | null = null
    let previousSegment: EmotionTextSegment | null = null

    for (const segment of segments) {
      const item = await this.waitForPrepared(segment.index)
      this.prepared[segment.index] = undefined
      this.notify()
      this.assertActive()

      let segmentStarted = false
      await this.options.playPrepared(item, () => {
        segmentStarted = true
        const startedAt = this.now()
        const transitionGapMs =
          previousCompletedAt === null ? 0 : Math.max(0, startedAt - previousCompletedAt)
        if (previousSegment && transitionGapMs > previousSegment.targetMaxGapMs) {
          this.record(
            'Emotion Speech Buffer Underrun',
            `${this.segmentDetail(segment, this.preparedCount())} transitionGapMs=${Math.round(transitionGapMs)} targetMaxGapMs=${previousSegment.targetMaxGapMs}`,
          )
        }
        this.record(
          'Emotion Speech Segment Started',
          `${this.segmentDetail(segment, this.preparedCount())} transitionGapMs=${Math.round(transitionGapMs)} targetMaxGapMs=${previousSegment?.targetMaxGapMs ?? 0}`,
        )
      })
      if (!segmentStarted)
        throw new Error(`Emotion speech playback did not start: index=${segment.index}`)
      previousCompletedAt = this.now()
      previousSegment = segment
      this.record(
        'Emotion Speech Segment Completed',
        `${this.segmentDetail(segment, this.preparedCount())} durationMs=${Math.round(item.audio.durationMs)}`,
      )
    }
  }

  private async waitForInitialBuffer(segments: EmotionTextSegment[]): Promise<void> {
    while (true) {
      this.assertActive()
      this.throwProducerError()
      let bufferedMs = 0
      let contiguousPrepared = 0
      for (const segment of segments) {
        const item = this.prepared[segment.index]
        if (!item) break
        bufferedMs += item.audio.durationMs
        contiguousPrepared += 1
      }
      if (
        contiguousPrepared > 0 &&
        (bufferedMs >= EMOTION_SPEECH_TUNING.initialBufferedAudioMs || this.producerDone)
      )
        return
      await this.waitForNotification()
    }
  }

  private async waitForPrepared(index: number): Promise<PreparedEmotionSpeechSegment> {
    while (true) {
      this.assertActive()
      const item = this.prepared[index]
      if (item) return item
      this.throwProducerError()
      if (this.producerDone)
        throw new Error(`Emotion speech segment was not prepared: index=${index}`)
      await this.waitForNotification()
    }
  }

  private async waitForCapacity(): Promise<void> {
    while (
      this.preparedCount() >=
      (this.consumerStarted
        ? EMOTION_SPEECH_TUNING.maxPreparedAhead
        : EMOTION_SPEECH_TUNING.maxPreparedAhead + 1)
    ) {
      this.assertActive()
      await this.waitForNotification()
    }
  }

  private assertActive(): void {
    if (!this.cancelled && this.options.isCurrentTurn()) return
    if (!this.cancelled) {
      this.cancelled = true
      this.prepared.length = 0
      this.recordCancellation()
    }
    throw new EmotionSpeechPipelineCancelledError(this.options.turnId)
  }

  private throwProducerError(): void {
    if (this.producerError) throw this.producerError
  }

  private preparedCount(): number {
    return this.prepared.reduce((count, item) => count + (item ? 1 : 0), 0)
  }

  private segmentDetail(segment: EmotionTextSegment, bufferedAhead: number): string {
    return `turnId=${this.options.turnId} segmentIndex=${segment.index} emotion=${segment.emotion} bufferedAhead=${bufferedAhead}`
  }

  private recordCancellation(): void {
    if (this.cancellationRecorded) return
    this.cancellationRecorded = true
    this.record('Emotion Speech Pipeline Cancelled', `turnId=${this.options.turnId}`)
  }

  private record(label: string, detail: string): void {
    this.options.recordEvent?.(label, detail)
  }

  private now(): number {
    return this.options.now?.() ?? performance.now()
  }

  private waitForNotification(): Promise<void> {
    return new Promise((resolve) => {
      this.notification = resolve
    })
  }

  private notify(): void {
    const notification = this.notification
    this.notification = null
    notification?.()
  }
}

export class EmotionSpeechPipelineCancelledError extends Error {
  constructor(readonly turnId: string) {
    super(`Emotion speech pipeline cancelled turnId=${turnId}`)
    this.name = 'EmotionSpeechPipelineCancelledError'
  }
}
