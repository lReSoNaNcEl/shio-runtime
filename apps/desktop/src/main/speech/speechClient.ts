import axios, { type AxiosInstance } from 'axios'

import { type EmotionContract, emotionRegistry } from '../../shared/emotion'
import type { SpeechAudioBoundaryTelemetry, SpeechUtteranceKind } from '../../shared/speech'
import { observeAxiosNetwork } from '../diagnostics/observeAxiosNetwork'
import { mainLog } from '../logging/safeLogger'
import { type Health, HealthSchema, type Recognize, RecognizeSchema } from '../schemas'
import { normalizeSpeechError, SpeechServiceError } from './speechErrors'

export type { Health, Recognize }

export const DEFAULT_TTS_VOICE_ID = 'animevox_makima'

/**
 * Per-capability projection derived from a successful `/health` response. A
 * reachable service does not imply every engine is up: ASR, F5 (TTS), and the
 * streaming transport are reported independently so the renderer can render
 * partial availability.
 */
export interface SpeechCapabilitiesProbe {
  serviceReachable: boolean
  recognition: boolean
  synthesis: boolean
  streaming: boolean
}

function isEngineOk(status: string | undefined): boolean {
  if (!status) return true // absent = not reported as failed; treat as available
  const s = status.toLowerCase()
  return s === 'ok' || s === 'ready' || s === 'available' || s === 'up'
}

/** Derive per-capability availability from a parsed `/health` payload. */
export function deriveCapabilities(health: Health): SpeechCapabilitiesProbe {
  const asrStatus = health.asr?.status
  const f5Status = health.engines?.f5?.status
  return {
    serviceReachable: true,
    recognition: isEngineOk(asrStatus),
    synthesis: isEngineOk(f5Status),
    // The streaming transport rides on the same service; if the service is
    // reachable and ASR is up, streaming is considered available.
    streaming: isEngineOk(asrStatus),
  }
}

export interface SynthesizeResult {
  audioBuffer: ArrayBuffer
  emotion?: string
  requestedEmotion?: string
  textEmotion?: string
  vrmEmotion?: string
  latencyMs?: string
  generatedLatencyMs?: string
  cache?: string
  rtf?: string
  durationSec?: string
  audioBoundaries?: SpeechAudioBoundaryTelemetry
}

export interface VoiceWarmupResult {
  state: 'warming' | 'ready' | 'failed'
  engine: string
  voiceId: string
  language: string
  latencyMs?: number
  error?: string
}

export interface SynthesizeParams {
  text: string
  language?: string
  emotion?: string
  voiceId?: string
  speed?: number
  pitch?: number
  engine?: string
  utteranceKind?: SpeechUtteranceKind
}

export interface SpeechSynthesisClient {
  synthesize(params: SynthesizeParams, signal?: AbortSignal): Promise<SynthesizeResult>
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

export class SpeechClient implements SpeechSynthesisClient {
  private http: AxiosInstance
  private readonly lifecycle = new AbortController()
  private readonly disposeNetworkObserver: () => void
  private disposed = false

  constructor(baseUrl: string) {
    // Force IPv4: Node inside Electron may resolve `localhost` to ::1 first, but
    // uvicorn binds IPv4 (0.0.0.0) - that mismatch surfaces as AggregateError.
    const ipv4Url = baseUrl.replace('://localhost', '://127.0.0.1')
    this.http = axios.create({
      baseURL: ipv4Url,
      timeout: 120_000,
      // The local speech backend should never be routed through a proxy.
      proxy: false,
    })
    this.disposeNetworkObserver = observeAxiosNetwork(this.http, 'speech-api')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifecycle.abort(new Error('Speech client disposed'))
    this.disposeNetworkObserver()
  }

  async health(signal?: AbortSignal): Promise<Health> {
    const request = this.requestSignal(signal)
    try {
      const res = await this.http.get('/health', { signal: request.signal })
      return HealthSchema.parse(res.data)
    } catch (error) {
      throw normalizeSpeechError(error, 'health')
    } finally {
      request.dispose()
    }
  }

  async emotions(signal?: AbortSignal): Promise<EmotionContract> {
    const request = this.requestSignal(signal)
    try {
      const res = await this.http.get('/emotions', { signal: request.signal })
      return {
        schemaVersion: Number(res.data?.schemaVersion),
        defaultEmotion: String(res.data?.defaultEmotion ?? ''),
        supported: Array.isArray(res.data?.supported) ? res.data.supported.map(String) : [],
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
      const res = await this.http.post('/recognize', form, { signal: request.signal })
      return RecognizeSchema.parse(res.data)
    } catch (error) {
      throw normalizeSpeechError(error, 'recognition')
    } finally {
      request.dispose()
    }
  }

  async warmupVoice(
    input: {
      engine: string
      voiceId: string
      language: string
    },
    signal?: AbortSignal,
  ): Promise<VoiceWarmupResult> {
    const request = this.requestSignal(signal)
    try {
      const response = await this.http.post('/tts/warmup', input, { signal: request.signal })
      return response.data as VoiceWarmupResult
    } catch (error) {
      throw normalizeSpeechError(error, 'synthesis')
    } finally {
      request.dispose()
    }
  }

  async synthesize(params: SynthesizeParams, signal?: AbortSignal): Promise<SynthesizeResult> {
    try {
      return await this.synthesizeInternal(params, signal)
    } catch (error) {
      throw normalizeSpeechError(error, 'synthesis')
    }
  }

  private async synthesizeInternal(
    params: SynthesizeParams,
    signal?: AbortSignal,
  ): Promise<SynthesizeResult> {
    const request = this.requestSignal(signal)
    try {
      const res = await this.http.post(
        '/synthesize',
        {
          text: params.text,
          language: params.language ?? 'ru',
          emotion: params.emotion ?? 'neutral',
          voiceId: params.voiceId ?? DEFAULT_TTS_VOICE_ID,
          speed: params.speed ?? 1.0,
          pitch: params.pitch ?? 0,
          engine: params.engine ?? 'f5',
          utteranceKind: params.utteranceKind ?? 'normal',
        },
        { responseType: 'arraybuffer', signal: request.signal },
      )
      const data = res.data as ArrayBuffer | Buffer
      const contentType = String(res.headers['content-type'] ?? '').toLowerCase()
      const byteLength = Buffer.isBuffer(data) ? data.byteLength : data.byteLength
      if (!contentType.startsWith('audio/') || byteLength < 44) {
        throw new SpeechServiceError({
          code: 'INVALID_RESPONSE',
          operation: 'synthesis',
          recoverable: false,
          technicalMessage: `invalid audio (content-type=${contentType || 'missing'}, bytes=${byteLength})`,
        })
      }
      // axios may return a Node Buffer; normalize to a standalone ArrayBuffer
      if (Buffer.isBuffer(data)) {
        const ab = new ArrayBuffer(data.byteLength)
        new Uint8Array(ab).set(data)
        return {
          audioBuffer: ab,
          emotion: res.headers['x-emotion'],
          requestedEmotion: res.headers['x-requested-emotion'],
          textEmotion: res.headers['x-text-emotion'],
          vrmEmotion: res.headers['x-vrm-emotion'],
          latencyMs: res.headers['x-latency-ms'],
          generatedLatencyMs: res.headers['x-generated-latency-ms'],
          cache: res.headers['x-cache'],
          rtf: res.headers['x-rtf'],
          durationSec: res.headers['x-duration-sec'],
          audioBoundaries: parseAudioBoundaryTelemetry(res.headers),
        }
      }
      return {
        audioBuffer: data,
        emotion: res.headers['x-emotion'],
        requestedEmotion: res.headers['x-requested-emotion'],
        textEmotion: res.headers['x-text-emotion'],
        vrmEmotion: res.headers['x-vrm-emotion'],
        latencyMs: res.headers['x-latency-ms'],
        generatedLatencyMs: res.headers['x-generated-latency-ms'],
        cache: res.headers['x-cache'],
        rtf: res.headers['x-rtf'],
        durationSec: res.headers['x-duration-sec'],
        audioBoundaries: parseAudioBoundaryTelemetry(res.headers),
      }
    } finally {
      request.dispose()
    }
  }

  private requestSignal(signal?: AbortSignal): RequestSignal {
    return combineAbortSignals(signal ? [this.lifecycle.signal, signal] : [this.lifecycle.signal])
  }
}

function parseAudioBoundaryTelemetry(
  headers: Record<string, unknown>,
): SpeechAudioBoundaryTelemetry | undefined {
  const profile = headerString(headers, 'x-audio-boundary-profile')
  if (!profile) return undefined
  const values = [
    headerNumber(headers, 'x-audio-leading-silence-ms'),
    headerNumber(headers, 'x-audio-trailing-silence-ms'),
    headerNumber(headers, 'x-audio-trimmed-leading-ms'),
    headerNumber(headers, 'x-audio-trimmed-trailing-ms'),
    headerNumber(headers, 'x-audio-fade-in-ms'),
    headerNumber(headers, 'x-audio-fade-out-ms'),
    headerNumber(headers, 'x-audio-postprocess-ms'),
  ]
  if (values.some((value) => value === undefined)) return undefined
  const [
    leadingSilenceMs,
    trailingSilenceMs,
    trimmedLeadingMs,
    trimmedTrailingMs,
    fadeInMs,
    fadeOutMs,
    postprocessMs,
  ] = values as number[]
  return {
    profile,
    leadingSilenceMs,
    trailingSilenceMs,
    trimmedLeadingMs,
    trimmedTrailingMs,
    fadeInMs,
    fadeOutMs,
    postprocessMs,
  }
}

function headerString(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name]
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value
}

function headerNumber(headers: Record<string, unknown>, name: string): number | undefined {
  const value = Number(headers[name])
  return Number.isFinite(value) && value >= 0 ? value : undefined
}
