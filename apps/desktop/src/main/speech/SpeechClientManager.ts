import type { EmotionContract } from '../../shared/emotion'
import type { SpeechStreamOutput, SpeechStreamStart } from '../../shared/speech'
import type { Health, Recognize } from '../schemas'
import {
  SpeechClient,
  type SpeechStreamConnection,
  type SpeechStreamingClient,
  type VoiceWarmupResult,
} from './speechClient'

export interface ManagedSpeechClient extends SpeechStreamingClient {
  dispose(): void
  health(signal?: AbortSignal): Promise<Health>
  emotions(signal?: AbortSignal): Promise<EmotionContract>
  warnIfEmotionContractDrift(signal?: AbortSignal): Promise<void>
  recognize(wavBuffer: ArrayBuffer, signal?: AbortSignal): Promise<Recognize>
  warmupVoice(
    input: { engine: string; voiceId: string; language: string },
    signal?: AbortSignal,
  ): Promise<VoiceWarmupResult>
}

type SpeechClientFactory = (endpoint: string) => ManagedSpeechClient

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

export class SpeechClientManager implements SpeechStreamingClient {
  private readonly endpoint: string
  private current: ManagedSpeechClient
  private disposed = false

  constructor(
    endpoint: string,
    private readonly createClient: SpeechClientFactory = (value) => new SpeechClient(value),
  ) {
    this.endpoint = normalizeEndpoint(endpoint)
    this.current = this.createClient(this.endpoint)
  }

  getEndpoint(): string {
    return this.endpoint
  }

  getCurrent(): ManagedSpeechClient {
    this.assertActive()
    return this.current
  }

  health(signal?: AbortSignal): Promise<Health> {
    return this.getCurrent().health(signal)
  }

  emotions(signal?: AbortSignal): Promise<EmotionContract> {
    return this.getCurrent().emotions(signal)
  }

  warnIfEmotionContractDrift(signal?: AbortSignal): Promise<void> {
    return this.getCurrent().warnIfEmotionContractDrift(signal)
  }

  transcribe(wavBuffer: ArrayBuffer, signal?: AbortSignal): Promise<Recognize> {
    return this.getCurrent().recognize(wavBuffer, signal)
  }

  warmupVoice(
    input: { engine: string; voiceId: string; language: string },
    signal?: AbortSignal,
  ): Promise<VoiceWarmupResult> {
    return this.getCurrent().warmupVoice(input, signal)
  }

  openStream(
    input: SpeechStreamStart,
    onEvent: (event: SpeechStreamOutput) => void,
  ): SpeechStreamConnection {
    return this.getCurrent().openStream(input, onEvent)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.current.dispose()
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('SpeechClientManager is disposed')
  }
}
