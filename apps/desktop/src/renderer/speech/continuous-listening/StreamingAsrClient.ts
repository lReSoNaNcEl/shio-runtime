import { z } from 'zod'

export type StreamingAsrState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'reconnecting'
  | 'stopping'
  | 'error'

const sessionIdSchema = z.string().trim().min(1).max(200)
const segmentIdSchema = z.string().trim().min(1).max(200)
const timestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const confidenceSchema = z.number().min(0).max(1).optional()
const transcriptSchema = z.string().max(16_000)
const eventCodeSchema = z.string().trim().min(1).max(100)
const messageSchema = z.string().max(1_000)

export const asrStreamEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ready'),
      protocolVersion: z.literal(1),
      sessionId: sessionIdSchema,
      acceptedSampleRate: z.number().int().min(8_000).max(192_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('speech_started'),
      sessionId: sessionIdSchema,
      segmentId: segmentIdSchema,
      timestampMs: timestampSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('partial'),
      sessionId: sessionIdSchema,
      segmentId: segmentIdSchema,
      revision: z.number().int().nonnegative().max(1_000_000),
      text: transcriptSchema,
      startMs: timestampSchema,
      endMs: timestampSchema,
      confidence: confidenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('final'),
      sessionId: sessionIdSchema,
      segmentId: segmentIdSchema,
      revision: z.number().int().nonnegative().max(1_000_000),
      text: transcriptSchema,
      startMs: timestampSchema,
      endMs: timestampSchema,
      confidence: confidenceSchema,
      reason: z.enum(['vad_silence', 'flush', 'max_duration', 'disconnect']),
    })
    .strict(),
  z
    .object({
      type: z.literal('speech_ended'),
      sessionId: sessionIdSchema,
      segmentId: segmentIdSchema,
      timestampMs: timestampSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('warning'),
      sessionId: sessionIdSchema,
      code: eventCodeSchema,
      message: messageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('error'),
      sessionId: sessionIdSchema.optional(),
      code: eventCodeSchema,
      message: messageSchema,
      recoverable: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('pong'),
      sessionId: sessionIdSchema.optional(),
      timestamp: timestampSchema,
    })
    .strict(),
])

export type AsrStreamEvent = z.infer<typeof asrStreamEventSchema>

export const ASR_STREAM_MAX_JSON_MESSAGE_CHARS = 64 * 1_024

export type AsrStreamParseErrorCode =
  | 'ASR_PROTOCOL_NON_TEXT'
  | 'ASR_PROTOCOL_MESSAGE_TOO_LARGE'
  | 'ASR_PROTOCOL_INVALID_JSON'
  | 'ASR_PROTOCOL_SCHEMA_INVALID'

export type AsrStreamParseResult =
  | { ok: true; event: AsrStreamEvent }
  | { ok: false; code: AsrStreamParseErrorCode }

export function parseAsrStreamEvent(raw: unknown): AsrStreamParseResult {
  if (typeof raw !== 'string') return { ok: false, code: 'ASR_PROTOCOL_NON_TEXT' }
  if (raw.length > ASR_STREAM_MAX_JSON_MESSAGE_CHARS) {
    return { ok: false, code: 'ASR_PROTOCOL_MESSAGE_TOO_LARGE' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { ok: false, code: 'ASR_PROTOCOL_INVALID_JSON' }
  }
  const result = asrStreamEventSchema.safeParse(parsed)
  return result.success
    ? { ok: true, event: result.data }
    : { ok: false, code: 'ASR_PROTOCOL_SCHEMA_INVALID' }
}

export interface StreamingAsrClientHandlers {
  onEvent: (event: AsrStreamEvent) => void
  onState: (state: StreamingAsrState) => void
  onProtocolDiagnostic?: (code: AsrStreamParseErrorCode) => void
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
  private generation = 0
  private protocolDiagnosticCount = 0
  private malformedMessageCount = 0

  constructor(private readonly handlers: StreamingAsrClientHandlers) {}

  async connect(baseUrl: string, language = 'ru', signal?: AbortSignal): Promise<void> {
    await this.stop()
    if (signal?.aborted) throw signal.reason ?? new DOMException('ASR start aborted', 'AbortError')
    const generation = ++this.generation
    this.shouldRun = true
    this.language = language
    this.wsBase = baseUrl
      .replace('://localhost', '://127.0.0.1')
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:')
      .replace(/\/$/, '')
    this.reconnectAttempt = 0
    await this.openSocket(false, generation, signal)
  }

  sendPcm(frame: ArrayBuffer): void {
    if (!this.socket || (this.state !== 'ready' && this.state !== 'listening')) return
    if (this.socket.readyState !== WebSocket.OPEN) return
    if (this.socket.bufferedAmount > 1_000_000) return
    this.socket.send(frame)
    if (this.state === 'ready') this.setState('listening')
  }

  async stop(): Promise<void> {
    this.generation += 1
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
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'stop' }))
      } catch {
        // Closing below remains authoritative.
      }
    }
    this.clearSocketHandlers(socket)
    socket.close(1000)
    this.setState('idle')
  }

  private async openSocket(
    reconnecting: boolean,
    generation: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.shouldRun || generation !== this.generation) return
    this.setState(reconnecting ? 'reconnecting' : 'connecting')
    const sessionId = createSessionId()
    this.sessionId = sessionId
    this.protocolDiagnosticCount = 0
    this.malformedMessageCount = 0
    const socket = new WebSocket(`${this.wsBase}/ws/asr`)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        let timeout: number | undefined
        const cleanup = (): void => {
          if (timeout !== undefined) window.clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
        }
        const fail = (error: unknown): void => {
          if (settled) return
          settled = true
          cleanup()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
        const abort = (): void =>
          fail(signal?.reason ?? new DOMException('ASR start aborted', 'AbortError'))
        timeout = window.setTimeout(() => fail(new Error('ASR WebSocket ready timeout')), 15_000)
        signal?.addEventListener('abort', abort, { once: true })
        socket.onerror = () => fail(new Error('ASR WebSocket connection failed'))
        socket.onclose = () => fail(new Error('ASR WebSocket closed before ready'))
        socket.onopen = () => {
          if (!this.shouldRun || generation !== this.generation) {
            fail(new DOMException('ASR start superseded', 'AbortError'))
            return
          }
          socket.send(
            JSON.stringify({
              type: 'start',
              protocolVersion: 1,
              sessionId,
              sampleRate: 16_000,
              channels: 1,
              format: 'pcm_s16le',
              language: this.language,
            }),
          )
        }
        socket.onmessage = (message) => {
          const event = this.parseMessage(message.data, socket)
          if (!event) return
          if ('sessionId' in event && event.sessionId && event.sessionId !== this.sessionId) return
          if (event.type === 'ready') {
            if (settled) return
            settled = true
            cleanup()
            this.reconnectAttempt = 0
            this.installActiveHandlers(socket, generation)
            this.setState('ready')
            resolve()
          } else if (event.type === 'error' && !event.recoverable) {
            fail(new Error(`ASR_PROTOCOL_${event.code}`))
          }
        }
        if (signal?.aborted) abort()
      })
    } catch (error) {
      if (this.socket === socket) this.socket = null
      this.clearSocketHandlers(socket)
      socket.close()
      if (!reconnecting && generation === this.generation && this.shouldRun) this.setState('error')
      throw error
    }
  }

  private installActiveHandlers(socket: WebSocket, generation: number): void {
    socket.onmessage = (message) => {
      const event = this.parseMessage(message.data, socket)
      if (!event) return
      if ('sessionId' in event && event.sessionId && event.sessionId !== this.sessionId) return
      this.handlers.onEvent(event)
    }
    socket.onerror = () => socket.close()
    socket.onclose = () => {
      if (this.socket !== socket || generation !== this.generation) return
      this.socket = null
      this.sessionId = null
      this.scheduleReconnect(generation)
    }
  }

  private parseMessage(data: unknown, socket: WebSocket): AsrStreamEvent | undefined {
    const result = parseAsrStreamEvent(data)
    if (result.ok) {
      this.malformedMessageCount = 0
      return result.event
    }
    this.malformedMessageCount += 1
    if (this.protocolDiagnosticCount < 5) {
      this.protocolDiagnosticCount += 1
      this.handlers.onProtocolDiagnostic?.(result.code)
    }
    if (this.malformedMessageCount >= 8) socket.close(1002, 'Invalid ASR protocol')
    return undefined
  }

  private scheduleReconnect(generation: number): void {
    if (!this.shouldRun || generation !== this.generation || this.reconnectTimer !== null) return
    this.setState('reconnecting')
    const delay = Math.min(8_000, 500 * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      void this.openSocket(true, generation).catch(() => this.scheduleReconnect(generation))
    }, delay)
  }

  private clearSocketHandlers(socket: WebSocket): void {
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
  }

  private setState(state: StreamingAsrState): void {
    if (this.state === state) return
    this.state = state
    this.handlers.onState(state)
  }
}
