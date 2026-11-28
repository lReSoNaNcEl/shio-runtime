import type { WatchPlaybackPhrase } from '../../shared/watchTogether'
import type { CapturedPcmTiming } from '../audio/StreamingPcmCapture'
import {
  type AsrStreamEvent,
  StreamingAsrClient,
} from '../speech/continuous-listening/StreamingAsrClient'

/** Source speech has its own VAD session and never enters microphone admission. */
export class WatchPlaybackSpeech {
  private readonly client: StreamingAsrClient
  private activeSegment?: string
  private phrases: (WatchPlaybackPhrase & { segmentId: string })[] = []
  private sentSamples = 0
  private lastFrameAt = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>

  constructor(onFailure: () => void, onAudioGap: () => void) {
    this.client = new StreamingAsrClient({
      onAudioGap: () => {
        this.activeSegment = undefined
        this.phrases = []
        onAudioGap()
      },
      onEvent: (event) => {
        if (event.type === 'speech_started') {
          this.activeSegment = event.segmentId
        } else if (event.type === 'speech_ended') {
          if (event.segmentId === this.activeSegment) this.activeSegment = undefined
        } else if (event.type === 'partial' || event.type === 'final') {
          this.recordPhrase(event)
        } else if (event.type === 'error' && !event.recoverable) {
          onFailure()
        }
      },
      onState: (state) => {
        if (state === 'reconnecting' && !this.reconnectTimer) {
          this.activeSegment = undefined
          this.phrases = []
          this.reconnectTimer = setTimeout(onFailure, 12_000)
        } else if (state === 'ready') {
          this.sentSamples = 0
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = undefined
        }
      },
    })
  }

  async start(signal: AbortSignal): Promise<void> {
    const connection = await window.api.asr.getStreamingConnection()
    await this.client.connect(connection.baseUrl, signal)
  }

  push(frame: ArrayBuffer, timing: CapturedPcmTiming): void {
    if (this.client.sendPcm(frame, timing.discontinuous)) {
      this.sentSamples += frame.byteLength / 2
      this.lastFrameAt = timing.endedAt
    }
  }

  get speaking(): boolean {
    return this.activeSegment !== undefined
  }

  private recordPhrase(event: Extract<AsrStreamEvent, { type: 'final' | 'partial' }>): void {
    const final = event.type === 'final'
    if (final && event.segmentId === this.activeSegment) this.activeSegment = undefined
    this.phrases = this.phrases.filter((entry) => entry.segmentId !== event.segmentId)
    const text = event.text.trim().slice(-600)
    if (!text) return
    const endMs = Math.floor(this.lastFrameAt - Math.max(0, this.sentSamples / 16 - event.endMs))
    this.phrases.push({
      text,
      segmentId: event.segmentId,
      startMs: endMs - (event.endMs - event.startMs),
      endMs,
      final,
    })
    this.phrases = this.phrases.sort((a, b) => a.endMs - b.endMs).slice(-4)
  }

  observations(at: number): WatchPlaybackPhrase[] {
    this.phrases = this.phrases.filter((entry) => at - entry.endMs < 25_000)
    return this.phrases.map(({ startMs, endMs, text, final }) => ({
      startMs: Math.max(-45_000, Math.min(0, startMs - at)),
      endMs: Math.min(0, endMs - at),
      text,
      final,
    }))
  }

  transcript(): string {
    return this.observations(Date.now())
      .filter((entry) => entry.final)
      .map((entry) => entry.text)
      .join(' ')
      .slice(-1000)
  }

  async stop(): Promise<void> {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.activeSegment = undefined
    this.phrases = []
    await this.client.stop()
  }
}
