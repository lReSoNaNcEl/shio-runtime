import {
  type AsrStreamEvent,
  StreamingAsrClient,
} from '../speech/continuous-listening/StreamingAsrClient'

/** Source speech has its own VAD session and never enters microphone admission. */
export class WatchPlaybackSpeech {
  private readonly client: StreamingAsrClient
  private activeSegment?: string
  private phrases: { text: string; endedAt: number }[] = []
  private sentSamples = 0
  private lastFrameAt = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>

  constructor(onStart: () => void, onFailure: () => void, onAudioGap: () => void) {
    this.client = new StreamingAsrClient(
      {
        onAudioGap,
        onEvent: (event) => {
          if (event.type === 'speech_started') {
            this.activeSegment = event.segmentId
            onStart()
          } else if (event.type === 'final') {
            this.finish(event)
          } else if (event.type === 'error' && !event.recoverable) {
            onFailure()
          }
        },
        onState: (state) => {
          if (state === 'reconnecting' && !this.reconnectTimer) {
            this.activeSegment = undefined
            this.phrases = []
            onStart()
            this.reconnectTimer = setTimeout(onFailure, 12_000)
          } else if (state === 'ready') {
            this.sentSamples = 0
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = undefined
          }
        },
      },
      false,
    )
  }

  async start(signal: AbortSignal): Promise<void> {
    const connection = await window.api.asr.getStreamingConnection()
    await this.client.connect(connection.baseUrl, 'auto', signal)
  }

  push(frame: ArrayBuffer, shioSpeaking: boolean): void {
    // Keep the VAD clock running while excluding Shio's own voice from loopback.
    if (shioSpeaking) new Int16Array(frame).fill(0)
    if (this.client.sendPcm(frame)) {
      this.sentSamples += frame.byteLength / 2
      this.lastFrameAt = Date.now()
    }
  }

  get speaking(): boolean {
    return this.activeSegment !== undefined || this.reconnectTimer !== undefined
  }

  private finish(event: Extract<AsrStreamEvent, { type: 'final' }>): void {
    if (event.segmentId === this.activeSegment) this.activeSegment = undefined
    const text = event.text.trim().slice(-600)
    if (!text) return
    const lagMs = Math.max(0, this.sentSamples / 16 - event.endMs)
    this.phrases.push({ text, endedAt: this.lastFrameAt - lagMs })
    this.phrases = this.phrases.slice(-3)
  }

  transcript(): string {
    this.phrases = this.phrases.filter((entry) => Date.now() - entry.endedAt < 30_000)
    return this.phrases
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
