import axios, { type AxiosInstance } from 'axios'
import { HealthSchema, RecognizeSchema, type Health, type Recognize } from '../schemas'
import { emotionRegistry, type EmotionContract } from '../../shared/emotions'
import { mainLog } from '../logging/safeLogger'

export type { Health, Recognize }

const DEFAULT_TTS_VOICE_ID = 'animevox_makima'

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
}

export class SpeechClient {
  private http: AxiosInstance

  constructor(baseUrl: string) {
    // Force IPv4: Node inside Electron may resolve `localhost` to ::1 first, but
    // uvicorn binds IPv4 (0.0.0.0) - that mismatch surfaces as AggregateError.
    const ipv4Url = baseUrl.replace('://localhost', '://127.0.0.1')
    this.http = axios.create({
      baseURL: ipv4Url,
      timeout: 120_000,
      // The local speech backend should never be routed through a proxy.
      proxy: false
    })
  }

  async health(): Promise<Health> {
    const res = await this.http.get('/health')
    return HealthSchema.parse(res.data)
  }

  async emotions(): Promise<EmotionContract> {
    const res = await this.http.get('/emotions')
    return {
      schemaVersion: Number(res.data?.schemaVersion),
      defaultEmotion: String(res.data?.defaultEmotion ?? ''),
      supported: Array.isArray(res.data?.supported) ? res.data.supported.map(String) : []
    }
  }

  async warnIfEmotionContractDrift(): Promise<void> {
    try {
      const remote = await this.emotions()
      if (emotionRegistry.hasDrift(remote)) {
        mainLog.warn('[emotion] Architecture drift between Shio Runtime and speech backend', {
          local: emotionRegistry.contract(),
          remote
        })
      }
    } catch (error) {
      mainLog.warn('[emotion] Unable to verify speech backend emotion contract', error)
    }
  }

  async recognize(wavBuffer: ArrayBuffer): Promise<Recognize> {
    const form = new FormData()
    form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav')
    const res = await this.http.post('/recognize', form)
    return RecognizeSchema.parse(res.data)
  }

  async synthesize(params: {
    text: string
    language?: string
    emotion?: string
    voiceId?: string
    speed?: number
    pitch?: number
    engine?: string
  }): Promise<SynthesizeResult> {
    const res = await this.http.post(
      '/synthesize',
      {
        text: params.text,
        language: params.language ?? 'ru',
        emotion: params.emotion ?? 'neutral',
        voiceId: params.voiceId ?? DEFAULT_TTS_VOICE_ID,
        speed: params.speed ?? 1.0,
        pitch: params.pitch ?? 0,
        engine: params.engine ?? 'f5'
      },
      { responseType: 'arraybuffer' }
    )
    const data = res.data as ArrayBuffer | Buffer
    const contentType = String(res.headers['content-type'] ?? '').toLowerCase()
    const byteLength = Buffer.isBuffer(data) ? data.byteLength : data.byteLength
    if (!contentType.startsWith('audio/') || byteLength < 44) {
      throw new Error(`Speech service returned invalid audio (content-type=${contentType || 'missing'}, bytes=${byteLength})`)
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
        durationSec: res.headers['x-duration-sec']
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
      durationSec: res.headers['x-duration-sec']
    }
  }
}
