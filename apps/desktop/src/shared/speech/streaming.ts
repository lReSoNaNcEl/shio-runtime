export const TTS_STREAM_PROTOCOL_VERSION = 1 as const

export const SPEECH_EMOTIONS = [
  'neutral',
  'calm',
  'warm',
  'happy',
  'laugh',
  'chuckle',
  'sad',
  'crying',
  'angry',
  'fear',
  'surprised',
  'gasp',
  'sigh',
  'groan',
  'whisper',
] as const
export type SpeechEmotion = (typeof SPEECH_EMOTIONS)[number]

export interface SpeechDeliveryIntent {
  emotion: SpeechEmotion
  pace: 'slow' | 'normal' | 'fast'
  energy: 'low' | 'normal' | 'high'
  volume: 'soft' | 'normal' | 'loud'
}

export interface SpeechStreamStart {
  protocolVersion: typeof TTS_STREAM_PROTOCOL_VERSION
  sessionId: string
  turnId: string
  voiceId: string
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
      engine: 'cosyvoice3'
      sampleRate: number
      channels: 1
      sampleFormat: 'float32-le'
      modelId: string
      modelRevision: string
      sourceRevision: string
    }
  | { type: 'audio'; sequence: number; samples: number; pcm: ArrayBuffer }
  | { type: 'complete'; sequence: number; sessionId: string }
  | { type: 'cancelled'; sessionId: string }
  | { type: 'error'; code: string; message: string }

/** Context-bridge-safe renderer facade over the preload-owned MessagePort. */
export interface SpeechStreamRendererPort {
  postMessage(input: SpeechStreamInput): void
  close(): void
  start(onMessage: (output: SpeechStreamOutput) => void, onMessageError: () => void): void
}
