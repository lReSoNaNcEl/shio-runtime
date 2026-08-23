import type { EmotionContract } from '../../shared/emotion'
import type { Health, Recognize } from '../schemas'
import {
  SpeechClient,
  type SpeechSynthesisClient,
  type SynthesizeParams,
  type SynthesizeResult,
  type VoiceWarmupResult,
} from './speechClient'

export interface ManagedSpeechClient extends SpeechSynthesisClient {
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

export class SpeechClientManager implements SpeechSynthesisClient {
  private endpoint: string
  private current: ManagedSpeechClient
  private disposed = false

  constructor(
    endpoint: string,
    private readonly createClient: SpeechClientFactory = (value) => new SpeechClient(value),
  ) {
    this.endpoint = normalizeEndpoint(endpoint)
    this.current = this.createClient(this.endpoint)
  }

  getCurrent(): ManagedSpeechClient {
    this.assertActive()
    return this.current
  }

  reconfigure(endpoint: string): boolean {
    this.assertActive()
    const normalized = normalizeEndpoint(endpoint)
    if (normalized === this.endpoint) return false

    const next = this.createClient(normalized)
    const previous = this.current
    this.endpoint = normalized
    this.current = next
    previous.dispose()
    return true
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

  synthesize(params: SynthesizeParams, signal?: AbortSignal): Promise<SynthesizeResult> {
    return this.getCurrent().synthesize(params, signal)
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
