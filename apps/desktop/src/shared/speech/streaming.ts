export const TTS_STREAM_PROTOCOL_VERSION = 2 as const

import type { SPEECH_EMOTIONS } from './emotions.generated'

export { SPEECH_EMOTIONS } from './emotions.generated'
export type SpeechEmotion = (typeof SPEECH_EMOTIONS)[number]

export interface SpeechDeliveryIntent {
  emotion: SpeechEmotion
  pace: 'slow' | 'normal' | 'fast'
  energy: 'low' | 'normal' | 'high'
  volume: 'soft' | 'normal' | 'loud'
  style?: string
}

export interface SpeechStreamStart {
  protocolVersion: typeof TTS_STREAM_PROTOCOL_VERSION
  sessionId: string
  turnId: string
  voiceId?: string
  language: 'ru' | 'en'
  delivery: SpeechDeliveryIntent
}

export type SpeechStreamStartMessage = SpeechStreamStart & { type: 'start' }

export type SpeechStreamInput =
  | { type: 'text'; sequence: number; text: string }
  | { type: 'delivery'; sequence: number; delivery: SpeechDeliveryIntent }
  | { type: 'finish-input' }
  | { type: 'cancel'; reason: string }
  | { type: 'audio-ack'; sequence: number }

export type SpeechStreamOutput =
  | {
      type: 'ready'
      protocolVersion: typeof TTS_STREAM_PROTOCOL_VERSION
      sessionId: string
      engine: 'fish-s2-pro'
      sampleRate: number
      channels: 1
      sampleFormat: 'float32-le'
      modelId: string
      modelRevision: string
      sourceRevision: string
    }
  | {
      type: 'audio'
      sessionId: string
      turnId: string
      sequence: number
      samples: number
      sampleOffset: number
      pcm: ArrayBuffer
      emotion?: SpeechEmotion
      textSequence?: number
    }
  | { type: 'complete'; sequence: number; sessionId: string }
  | { type: 'cancelled'; sessionId: string }
  | { type: 'error'; code: string; message: string }

/** Context-bridge-safe renderer facade over the preload-owned MessagePort. */
export interface SpeechStreamRendererPort {
  postMessage(input: SpeechStreamInput): void
  close(): void
  start(onMessage: (output: SpeechStreamOutput) => void, onMessageError: () => void): void
}
