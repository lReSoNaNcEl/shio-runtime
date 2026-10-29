import { setTimeout as delay } from 'node:timers/promises'

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
      protocolVersion: z.literal(2),
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
      sessionId: z.string().max(128),
      turnId: z.string().max(100),
      sequence: z.number().int().min(0).max(100_000),
      samples: z.number().int().min(1).max(88_200),
      sampleOffset: z.number().int().min(0).max(26_460_000),
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
  cancel(reason: string): Promise<void>
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
  private recoveryReadinessRequired = false

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
    let socket: WebSocket | null = null
    const recoveryWait = new AbortController()
    let pendingAudio: Omit<Extract<SpeechStreamOutput, { type: 'audio' }>, 'type' | 'pcm'> | null =
      null
    let terminal = false
    let cancelling = false
    let readySeen = false
    let expectedSequence = 0
    let expectedOffset = 0
    let cancelTimer: ReturnType<typeof setTimeout> | null = null
    const queued: SpeechStreamInput[] = []
    let resolveSettlement!: () => void
    let rejectSettlement!: (error: Error) => void
    const settlement = new Promise<void>((resolve, reject) => {
      resolveSettlement = resolve
      rejectSettlement = reject
    })
    // onEvent reports failures even when no cancellation caller awaits settlement.
    void settlement.catch(() => undefined)
    const finish = (failure?: Error): void => {
      if (terminal) return
      terminal = true
      recoveryWait.abort()
      if (cancelTimer !== null) clearTimeout(cancelTimer)
      cancelTimer = null
      queued.length = 0
      pendingAudio = null
      this.streams.delete(connection)
      if (failure) rejectSettlement(failure)
      else resolveSettlement()
    }
    const fail = (code: string, message: string): void => {
      if (terminal) return
      onEvent({ type: 'error', code, message })
      finish(new Error(message))
      socket?.close()
    }
    const connection: SpeechStreamConnection = {
      send: (message) => {
        if (terminal || cancelling) return
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
        else {
          if (queued.length >= 128) throw new Error('TTS input queue exceeded its bound')
          queued.push(message)
        }
      },
      cancel: (reason) => {
        if (terminal || cancelling) return settlement
        cancelling = true
        queued.length = 0
        pendingAudio = null
        if (!socket) {
          // No inference was started while waiting; cancellation needs no server round trip.
          queueMicrotask(() => {
            if (terminal) return
            finish()
            onEvent({ type: 'cancelled', sessionId: input.sessionId })
          })
          recoveryWait.abort()
          return settlement
        }
        this.recoveryReadinessRequired = true
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: 'cancel', reason }))
        cancelTimer = setTimeout(
          () => fail('cancel_timeout', 'Fish inference cancellation did not settle'),
          5000,
        )
        return settlement
      },
    }
    this.streams.add(connection)
    const connect = (): void => {
      const activeSocket = new WebSocket(`${this.baseUrl.replace(/^http/u, 'ws')}/tts/stream`)
      socket = activeSocket
      activeSocket.binaryType = 'arraybuffer'
      activeSocket.addEventListener('open', () => {
        if (terminal) {
          activeSocket.close()
          return
        }
        const start: SpeechStreamStartMessage = { type: 'start', ...input }
        activeSocket.send(JSON.stringify(start))
        if (cancelling)
          activeSocket.send(
            JSON.stringify({ type: 'cancel', reason: 'Cancelled before connection' }),
          )
        else for (const message of queued.splice(0)) activeSocket.send(JSON.stringify(message))
      })
      activeSocket.addEventListener('message', (message) => {
        if (terminal) return
        try {
          if (typeof message.data === 'string') {
            if (message.data.length > 16_384) throw new Error('Oversized TTS metadata')
            const event = speechServerMessageSchema.parse(JSON.parse(message.data))
            if ('sessionId' in event && event.sessionId !== input.sessionId)
              throw new Error('Wrong TTS session')
            if ('turnId' in event && event.turnId !== input.turnId)
              throw new Error('Wrong TTS turn')
            if (event.type === 'cancelled' || event.type === 'complete') {
              if (
                !cancelling &&
                event.type === 'complete' &&
                (!readySeen || pendingAudio || event.sequence !== expectedSequence)
              )
                throw new Error('Invalid TTS completion sequence')
              finish()
              onEvent(event)
              activeSocket.close()
              return
            }
            if (event.type === 'error') {
              finish(new Error(event.message))
              onEvent(event)
              activeSocket.close()
              return
            }
            if (cancelling) return
            if (event.type === 'ready') {
              if (readySeen) throw new Error('Duplicate TTS ready message')
              readySeen = true
              onEvent(event)
              return
            }
            if (
              !readySeen ||
              pendingAudio ||
              event.sequence !== expectedSequence ||
              event.sampleOffset !== expectedOffset
            )
              throw new Error('Invalid TTS audio metadata sequence or offset')
            expectedSequence += 1
            expectedOffset += event.samples
            const { type: _type, ...metadata } = event
            pendingAudio = metadata
            return
          }
          if (cancelling) return
          if (!(message.data instanceof ArrayBuffer) || !pendingAudio)
            throw new Error('Unexpected binary TTS payload')
          const metadata = pendingAudio
          pendingAudio = null
          if (
            message.data.byteLength !== metadata.samples * Float32Array.BYTES_PER_ELEMENT ||
            !new Float32Array(message.data).every(Number.isFinite)
          )
            throw new Error('Invalid PCM length or non-finite samples')
          onEvent({ type: 'audio', ...metadata, pcm: message.data })
        } catch (error) {
          fail(
            'invalid_stream_response',
            error instanceof Error ? error.message : 'Invalid TTS stream',
          )
        }
      })
      activeSocket.addEventListener('error', (event) => {
        const error = 'error' in event && event.error instanceof Error ? event.error : null
        mainLog.error('[SpeechClient] stream transport failed', {
          errorName: error?.name.slice(0, 80),
          reason: error?.message.slice(0, 240),
          cause: error?.cause instanceof Error ? error.cause.message.slice(0, 240) : undefined,
        })
        fail('stream_transport_error', 'TTS stream failed')
      })
      activeSocket.addEventListener('close', () => {
        if (!terminal) fail('stream_closed', 'TTS stream closed before inference settlement')
      })
    }
    if (this.recoveryReadinessRequired) {
      // Cancellation destroys the real Fish worker. Its acknowledgement precedes
      // the API-owned reload/warmup; poll readiness before this turn's only stream.
      void this.waitForSynthesisRecovery(recoveryWait.signal).then(
        () => {
          if (terminal || cancelling) return
          this.recoveryReadinessRequired = false
          try {
            connect()
          } catch (error) {
            fail(
              'stream_transport_error',
              error instanceof Error ? error.message : 'TTS stream failed',
            )
          }
        },
        (error: unknown) => {
          if (!terminal && !cancelling)
            fail(
              'synthesis_recovery_failed',
              error instanceof Error ? error.message : 'Fish recovery failed',
            )
        },
      )
    } else connect()
    return connection
  }

  private async waitForSynthesisRecovery(signal: AbortSignal): Promise<void> {
    const request = combineAbortSignals([signal, AbortSignal.timeout(120_000)])
    try {
      while (true) {
        request.signal.throwIfAborted()
        const health = await this.health(request.signal)
        if (deriveCapabilities(health).synthesis) return
        if (!['loading', 'warming'].includes(health.synthesis?.status ?? ''))
          throw new Error('Fish synthesis recovery is unavailable')
        await delay(500, undefined, { signal: request.signal })
      }
    } finally {
      request.dispose()
    }
  }

  private requestSignal(signal?: AbortSignal): RequestSignal {
    return combineAbortSignals(signal ? [this.lifecycle.signal, signal] : [this.lifecycle.signal])
  }
}
