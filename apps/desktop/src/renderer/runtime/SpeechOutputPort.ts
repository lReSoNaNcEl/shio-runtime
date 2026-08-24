import type { EmotionTextSegment } from '../../shared/emotion'
import type {
  AudioPlayer,
  AudioPlayOptions,
  PlaybackCompletion,
  PlaybackSession,
  PreparedAudio,
} from '../audio/audioPlayer'
import type { DebugSpeechTurn, SpeechRuntime, SuccessfulSpeechReply } from './SpeechRuntime'

export type SpeechPlaybackSession = PlaybackSession
export type PreparedSpeechAudio = PreparedAudio
export type SpeechPlaybackOptions = AudioPlayOptions

export interface SpeechOutputPort {
  hasSpeakableContent(text: string): boolean
  synthesizeSegment(turnId: string, segment: EmotionTextSegment): Promise<SuccessfulSpeechReply>
  createDebugSpeechTurn(turnId: string, emotionKey?: string): Promise<DebugSpeechTurn>
  prepare(audioBuffer: ArrayBuffer): Promise<PreparedSpeechAudio>
  play(audioBuffer: ArrayBuffer, options: SpeechPlaybackOptions): Promise<PlaybackCompletion>
  playPrepared(
    prepared: PreparedSpeechAudio,
    options: SpeechPlaybackOptions,
  ): Promise<PlaybackCompletion>
  stopCurrent(turnId: string, reason: 'conversation-interrupted'): void
}

/** Speech-output composition; AudioPlayer remains the sole playback owner. */
export class RuntimeSpeechOutputPort implements SpeechOutputPort {
  constructor(
    private readonly speech: SpeechRuntime,
    private readonly player: AudioPlayer,
  ) {}

  hasSpeakableContent(text: string): boolean {
    return this.speech.hasSpeakableContent(text)
  }

  synthesizeSegment(turnId: string, segment: EmotionTextSegment): Promise<SuccessfulSpeechReply> {
    return this.speech.synthesizeSegment(turnId, segment)
  }

  createDebugSpeechTurn(turnId: string, emotionKey?: string): Promise<DebugSpeechTurn> {
    return this.speech.createDebugSpeechTurn(turnId, emotionKey)
  }

  prepare(audioBuffer: ArrayBuffer): Promise<PreparedSpeechAudio> {
    return this.player.prepare(audioBuffer)
  }

  play(audioBuffer: ArrayBuffer, options: SpeechPlaybackOptions): Promise<PlaybackCompletion> {
    return this.player.play(audioBuffer, options)
  }

  playPrepared(
    prepared: PreparedSpeechAudio,
    options: SpeechPlaybackOptions,
  ): Promise<PlaybackCompletion> {
    return this.player.playPrepared(prepared, options)
  }

  stopCurrent(turnId: string, reason: 'conversation-interrupted'): void {
    this.player.stopCurrent(turnId, reason)
  }
}
