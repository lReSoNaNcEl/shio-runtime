import axios, { type AxiosInstance } from 'axios'

import { type EmotionContract, emotionRegistry } from '../../shared/emotion'
import type {
  SpeechStreamInput,
  SpeechStreamOutput,
  SpeechStreamStart,
  SpeechStreamStartMessage,
} from '../../shared/speech'
import { observeAxiosNetwork } from '../diagnostics/observeAxiosNetwork'
import { mainLog } from '../logging/safeLogger'
import { type Health, HealthSchema, type Recognize, RecognizeSchema } from '../schemas'
import { normalizeSpeechError, SpeechServiceError } from './speechErrors'

export type { Health, Recognize }

export const DEFAULT_TTS_VOICE_ID = 'animevox_makima'

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
    health.synthesis?.engine === 'cosyvoice3' &&
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
  send(message: Exclude<SpeechStreamInput, { type: 'audio-ack' }>): void
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
    let pendingAudio: { sequence: number; samples: number } | null = null
    let terminal = false
    const queued: Array<Exclude<SpeechStreamInput, { type: 'audio-ack' }>> = []

    const send = (message: Exclude<SpeechStreamInput, { type: 'audio-ack' }>): void => {
      if (terminal) return
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
      else queued.push(message)
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
      const start: SpeechStreamStartMessage = { type: 'start', ...input }
      socket.send(JSON.stringify(start))
      for (const message of queued.splice(0)) socket.send(JSON.stringify(message))
    })
    socket.addEventListener('message', (message) => {
      try {
        if (typeof message.data === 'string') {
          const event = JSON.parse(message.data) as SpeechStreamOutput
          if (event.type === 'audio') {
            if (pendingAudio || event.sequence < 0 || event.samples <= 0)
              throw new Error('Invalid audio metadata sequence')
            pendingAudio = { sequence: event.sequence, samples: event.samples }
            return
          }
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
