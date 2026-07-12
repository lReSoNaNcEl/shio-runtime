export type StreamingAsrState = 'idle' | 'connecting' | 'ready' | 'listening' | 'reconnecting' | 'stopping' | 'error'

export type AsrStreamEvent =
  | { type: 'ready'; protocolVersion: 1; sessionId: string; acceptedSampleRate: number }
  | { type: 'speech_started'; sessionId: string; segmentId: string; timestampMs: number }
  | { type: 'partial'; sessionId: string; segmentId: string; revision: number; text: string; startMs: number; endMs: number; confidence?: number }
  | { type: 'final'; sessionId: string; segmentId: string; revision: number; text: string; startMs: number; endMs: number; confidence?: number; reason: 'vad_silence' | 'flush' | 'max_duration' | 'disconnect' }
  | { type: 'speech_ended'; sessionId: string; segmentId: string; timestampMs: number }
  | { type: 'warning'; sessionId: string; code: string; message: string }
  | { type: 'error'; sessionId?: string; code: string; message: string; recoverable: boolean }
  | { type: 'pong'; sessionId?: string; timestamp: number }

export interface StreamingAsrClientHandlers {
  onEvent: (event: AsrStreamEvent) => void
  onState: (state: StreamingAsrState) => void
}

const createSessionId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `asr-${Date.now()}-${Math.random().toString(16).slice(2)}`

export class StreamingAsrClient {
  private socket: WebSocket | null = null
  private sessionId: string | null = null
  private state: StreamingAsrState = 'idle'
  private shouldRun = false
  private wsBase = ''
  private language = 'ru'
  private reconnectAttempt = 0
  private reconnectTimer: number | null = null

  constructor(private readonly handlers: StreamingAsrClientHandlers) {}

  async connect(baseUrl: string, language = 'ru'): Promise<void> {
    await this.stop()
    this.shouldRun = true
    this.language = language
    this.wsBase = baseUrl
      .replace('://localhost', '://127.0.0.1')
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:')
      .replace(/\/$/, '')
    this.reconnectAttempt = 0
    await this.openSocket(false)
  }

  sendPcm(frame: ArrayBuffer): void {
    if (!this.socket || (this.state !== 'ready' && this.state !== 'listening')) return
    if (this.socket.readyState !== WebSocket.OPEN) return
    // Browser WebSocket applies its own bounded transport buffering; while a
    // reconnect is in progress frames are intentionally dropped, never queued.
    if (this.socket.bufferedAmount > 1_000_000) return
    this.socket.send(frame)
    if (this.state === 'ready') this.setState('listening')
  }

  async stop(): Promise<void> {
    this.shouldRun = false
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    this.sessionId = null
    if (!socket) {
      this.setState('idle')
      return
    }
    this.setState('stopping')
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }))
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    socket.close(1000)
    this.setState('idle')
  }

  private async openSocket(reconnecting: boolean): Promise<void> {
    if (!this.shouldRun) return
    this.setState(reconnecting ? 'reconnecting' : 'connecting')
    const sessionId = createSessionId()
    this.sessionId = sessionId
    const socket = new WebSocket(`${this.wsBase}/ws/asr`)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('ASR WebSocket ready timeout')), 15_000)
      const fail = (message: string): void => {
        window.clearTimeout(timeout)
        reject(new Error(message))
      }
      socket.onerror = () => fail('ASR WebSocket connection failed')
      socket.onclose = () => fail('ASR WebSocket closed before ready')
      socket.onopen = () => socket.send(JSON.stringify({
        type: 'start',
        protocolVersion: 1,
        sessionId,
        sampleRate: 16_000,
        channels: 1,
        format: 'pcm_s16le',
        language: this.language
      }))
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as AsrStreamEvent
        if ('sessionId' in event && event.sessionId && event.sessionId !== this.sessionId) return
        if (event.type === 'ready') {
          window.clearTimeout(timeout)
          this.reconnectAttempt = 0
          this.installActiveHandlers(socket)
          this.setState('ready')
          resolve()
        } else if (event.type === 'error' && !event.recoverable) {
          fail(event.message)
        }
      }
    }).catch((error) => {
      if (this.socket === socket) this.socket = null
      socket.onclose = null
      socket.close()
      if (!reconnecting) this.setState('error')
      throw error
    })
  }

  private installActiveHandlers(socket: WebSocket): void {
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as AsrStreamEvent
      if ('sessionId' in event && event.sessionId && event.sessionId !== this.sessionId) return
      this.handlers.onEvent(event)
    }
    socket.onerror = () => socket.close()
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.sessionId = null
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun || this.reconnectTimer !== null) return
    this.setState('reconnecting')
    const delay = Math.min(8_000, 500 * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      void this.openSocket(true).catch(() => this.scheduleReconnect())
    }, delay)
  }

  private setState(state: StreamingAsrState): void {
    if (this.state === state) return
    this.state = state
    this.handlers.onState(state)
  }
}
