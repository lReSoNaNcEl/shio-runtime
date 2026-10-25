import axios, { type AxiosInstance } from 'axios'
import { z } from 'zod'

import { type EmotionContract, emotionRegistry } from '../../shared/emotion'
import type {
  SpeechStreamInput,
  SpeechStreamOutput,
  SpeechStreamStart,
  SpeechStreamStartMessage,
} from '../../shared/speech'
import { SPEECH_EMOTIONS } from '../../shared/speech'
import { observeAxiosNetwork } from '../diagnostics/observeAxiosNetwork'
import { mainLog } from '../logging/safeLogger'
import { type Health, HealthSchema, type Recognize, RecognizeSchema } from '../schemas'
import { normalizeSpeechError, SpeechServiceError } from './speechErrors'

export type { Health, Recognize }

export const DEFAULT_TTS_VOICE_ID = 'animevox_makima'

const speechServerMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ready'),
      protocolVersion: z.literal(1),
      sessionId: z.string().max(128),
      engine: z.literal('fish-s2-pro'),
      sampleRate: z.number().int().min(8000).max(48000),
      channels: z.literal(1),
      sampleFormat: z.literal('float32-le'),
      modelId: z.string().max(200),
      modelRevision: z.string().max(100),
      sourceRevision: z.string().max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal('audio'),
      sequence: z.number().int().min(0).max(100_000),
      samples: z.number().int().min(1).max(2_880_000),
      emotion: z.enum(SPEECH_EMOTIONS).optional(),
      textSequence: z.number().int().min(0).max(100_000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('complete'),
      sequence: z.number().int().min(0).max(100_000),
      sessionId: z.string().max(128),
    })
    .strict(),
  z.object({ type: z.literal('cancelled'), sessionId: z.string().max(128) }).strict(),
  z
    .object({ type: z.literal('error'), code: z.string().max(100), message: z.string().max(2000) })
    .strict(),
])

export interface SpeechCapabilitiesProbe {
  serviceReachable: boolean
  recognition: boolean
  synthesis: boolean
  streaming: boolean
}

function isEngineOk(status: string | undefined): boolean {
  if (!status) return true
  const normalized = status.toLowerCase()
  return ['ok', 'ready', 'available', 'up'].includes(normalized)
}

export function deriveCapabilities(health: Health): SpeechCapabilitiesProbe {
  const asrReady = isEngineOk(health.asr?.status)
  const synthesisReady =
    health.synthesis?.engine === 'fish-s2-pro' &&
    health.synthesis.streaming === true &&
    isEngineOk(health.synthesis.status)
  return {
    serviceReachable: true,
    recognition: asrReady,
    synthesis: synthesisReady,
    streaming: asrReady && synthesisReady,
  }
}

export interface VoiceWarmupResult {
  state: 'warming' | 'ready' | 'failed'
  engine: string
  voiceId: string
  language: string
  latencyMs?: number
  error?: string
}

export interface SpeechStreamConnection {
  send(message: SpeechStreamInput): void
  cancel(reason: string): void
}

export interface SpeechStreamingClient {
  openStream(
    input: SpeechStreamStart,
    onEvent: (event: SpeechStreamOutput) => void,
  ): SpeechStreamConnection
}

interface RequestSignal {
  signal: AbortSignal
  dispose(): void
}

function combineAbortSignals(signals: readonly AbortSignal[]): RequestSignal {
  const uniqueSignals = [...new Set(signals)]
  const controller = new AbortController()
  const abort = (event?: Event): void => {
    const source = event?.target
    controller.abort(source instanceof AbortSignal ? source.reason : undefined)
  }
  for (const signal of uniqueSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of uniqueSignals) signal.removeEventListener('abort', abort)
    },
  }
}

export class SpeechClient implements SpeechStreamingClient {
  private readonly http: AxiosInstance
  private readonly baseUrl: string
  private readonly lifecycle = new AbortController()
  private readonly disposeNetworkObserver: () => void
  private readonly streams = new Set<SpeechStreamConnection>()
  private disposed = false

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace('://localhost', '://127.0.0.1').replace(/\/+$/u, '')
    this.http = axios.create({ baseURL: this.baseUrl, timeout: 120_000, proxy: false })
    this.disposeNetworkObserver = observeAxiosNetwork(this.http, 'speech-api')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifecycle.abort(new Error('Speech client disposed'))
    for (const stream of this.streams) stream.cancel('Speech client disposed')
    this.streams.clear()
    this.disposeNetworkObserver()
  }

  async health(signal?: AbortSignal): Promise<Health> {
    const request = this.requestSignal(signal)
    try {
      return HealthSchema.parse((await this.http.get('/health', { signal: request.signal })).data)
    } catch (error) {
      throw normalizeSpeechError(error, 'health')
    } finally {
      request.dispose()
    }
  }

  async emotions(signal?: AbortSignal): Promise<EmotionContract> {
    const request = this.requestSignal(signal)
    try {
      const data = (await this.http.get('/emotions', { signal: request.signal })).data
      return {
        schemaVersion: Number(data?.schemaVersion),
        defaultEmotion: String(data?.defaultEmotion ?? ''),
        supported: Array.isArray(data?.supported) ? data.supported.map(String) : [],
      }
    } catch (error) {
      throw normalizeSpeechError(error, 'health')
    } finally {
      request.dispose()
    }
  }

  async warnIfEmotionContractDrift(signal?: AbortSignal): Promise<void> {
    try {
      const remote = await this.emotions(signal)
      if (emotionRegistry.hasDrift(remote)) {
        mainLog.warn('[emotion] Architecture drift between Shio Runtime and speech backend', {
          local: emotionRegistry.contract(),
          remote,
        })
      }
    } catch (error) {
      if (error instanceof SpeechServiceError && error.code === 'CANCELLED') return
      mainLog.warn('[emotion] Unable to verify speech backend emotion contract', error)
    }
  }

  async recognize(wavBuffer: ArrayBuffer, signal?: AbortSignal): Promise<Recognize> {
    const request = this.requestSignal(signal)
    try {
      const form = new FormData()
      form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav')
      return RecognizeSchema.parse(
        (await this.http.post('/recognize', form, { signal: request.signal })).data,
      )
    } catch (error) {
      throw normalizeSpeechError(error, 'recognition')
    } finally {
      request.dispose()
    }
  }

  async warmupVoice(
    input: { engine: string; voiceId: string; language: string },
    signal?: AbortSignal,
  ): Promise<VoiceWarmupResult> {
    const request = this.requestSignal(signal)
    try {
      return (await this.http.post('/tts/warmup', input, { signal: request.signal }))
        .data as VoiceWarmupResult
    } catch (error) {
      throw normalizeSpeechError(error, 'synthesis')
    } finally {
      request.dispose()
    }
  }

  openStream(
    input: SpeechStreamStart,
    onEvent: (event: SpeechStreamOutput) => void,
  ): SpeechStreamConnection {
    if (this.disposed) throw new Error('Speech client is disposed')
    const socketUrl = `${this.baseUrl.replace(/^http/u, 'ws')}/tts/stream`
    const socket = new WebSocket(socketUrl)
    socket.binaryType = 'arraybuffer'
    let pendingAudio: {
      sequence: number
      samples: number
      emotion?: (typeof SPEECH_EMOTIONS)[number]
      textSequence?: number
    } | null = null
    let terminal = false
    let readySeen = false
    let expectedAudioSequence = 0
    const queued: SpeechStreamInput[] = []

    const send = (message: SpeechStreamInput): void => {
      if (terminal) return
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
      else {
        if (queued.length >= 128) throw new Error('TTS input queue exceeded its bound')
        queued.push(message)
      }
    }
    const connection: SpeechStreamConnection = {
      send,
      cancel: (reason) => {
        if (terminal) return
        terminal = true
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'cancel', reason }))
          socket.close(1000, 'cancelled')
        } else {
          socket.close()
        }
        this.streams.delete(connection)
      },
    }
    this.streams.add(connection)

    socket.addEventListener('open', () => {
      if (terminal) {
        socket.close()
        return
      }
      const start: SpeechStreamStartMessage = { type: 'start', ...input }
      socket.send(JSON.stringify(start))
      for (const message of queued.splice(0)) socket.send(JSON.stringify(message))
    })
    socket.addEventListener('message', (message) => {
      if (terminal) return
      try {
        if (typeof message.data === 'string') {
          const event = speechServerMessageSchema.parse(JSON.parse(message.data))
          if ('sessionId' in event && event.sessionId !== input.sessionId)
            throw new Error('TTS response belongs to another session')
          if (event.type === 'ready') {
            if (readySeen) throw new Error('Duplicate TTS ready message')
            readySeen = true
          }
          if (event.type === 'audio') {
            if (
              !readySeen ||
              pendingAudio ||
              event.sequence !== expectedAudioSequence ||
              event.samples <= 0
            )
              throw new Error('Invalid audio metadata sequence')
            expectedAudioSequence += 1
            pendingAudio = {
              sequence: event.sequence,
              samples: event.samples,
              emotion: event.emotion,
              textSequence: event.textSequence,
            }
            return
          }
          if (
            event.type === 'complete' &&
            (!readySeen || pendingAudio || event.sequence !== expectedAudioSequence)
          )
            throw new Error('Invalid TTS completion sequence')
          if (event.type === 'complete' || event.type === 'cancelled' || event.type === 'error')
            terminal = true
          onEvent(event)
          if (terminal) this.streams.delete(connection)
          return
        }
        if (!(message.data instanceof ArrayBuffer) || !pendingAudio)
          throw new Error('Unexpected binary TTS payload')
        const metadata = pendingAudio
        pendingAudio = null
        if (message.data.byteLength !== metadata.samples * Float32Array.BYTES_PER_ELEMENT)
          throw new Error('PCM payload length does not match metadata')
        onEvent({ type: 'audio', ...metadata, pcm: message.data })
      } catch (error) {
        terminal = true
        onEvent({
          type: 'error',
          code: 'invalid_stream_response',
          message: error instanceof Error ? error.message : String(error),
        })
        socket.close()
        this.streams.delete(connection)
      }
    })
    socket.addEventListener('error', () => {
      if (terminal) return
      terminal = true
      onEvent({ type: 'error', code: 'stream_transport_error', message: 'TTS stream failed' })
      this.streams.delete(connection)
    })
    socket.addEventListener('close', () => {
      if (!terminal) {
        terminal = true
        onEvent({ type: 'error', code: 'stream_closed', message: 'TTS stream closed early' })
      }
      this.streams.delete(connection)
    })
    return connection
  }

  private requestSignal(signal?: AbortSignal): RequestSignal {
    return combineAbortSignals(signal ? [this.lifecycle.signal, signal] : [this.lifecycle.signal])
  }
}
