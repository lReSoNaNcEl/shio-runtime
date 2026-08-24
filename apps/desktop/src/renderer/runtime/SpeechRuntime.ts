import type { EmotionTextSegment } from '../../shared/emotion'
import type {
  CharacterRuntimeMode,
  CharacterSpeechState,
  CharacterState,
  EventBus,
} from '../../shared/runtime'
import type {
  SpeechAudioBoundaryTelemetry,
  SpeechPolishDebugState,
  SpeechTextNormalizationTelemetry,
} from '../../shared/speech'
import { hasSpeakableContent } from '../../shared/speech'
import { speechErrorFromResponse } from './speechCapabilities'

type SpeechReply = Awaited<ReturnType<Window['api']['tts']['synthesizeReply']>>
export type SuccessfulSpeechReply = SpeechReply & { ok: true; audioBuffer: ArrayBuffer }

export interface SpeechStateTimelineEntry {
  at: number
  from: CharacterSpeechState
  to: CharacterSpeechState
  mode: CharacterRuntimeMode
  durationMs: number | null
  emotion: string
}

export { hasSpeakableContent }

export interface DebugSpeechTurn {
  text: string
  emotionKey: string
  speech: SuccessfulSpeechReply
  ttsLatencyText: string | null
}

export interface RecognizedSpeech {
  text: string
}

export class SpeechRuntime {
  private speechTimeline: SpeechStateTimelineEntry[] = []
  private lastSpeechTransitionAt: number | null = null
  private speechPolishTurnId: string | null = null
  private speechPolishDebug: SpeechPolishDebugState = {
    normalization: [],
    audioBoundaries: [],
  }

  constructor(private readonly events: EventBus) {}

  observeCharacterState(previous: CharacterState, next: CharacterState): void {
    this.recordSpeechTimeline(
      previous.speechState.status,
      next.speechState.status,
      next.mode,
      next.emotion,
    )
  }

  getSpeechTimeline(): SpeechStateTimelineEntry[] {
    return [...this.speechTimeline]
  }

  getSpeechPolishDebugState(): SpeechPolishDebugState {
    return {
      normalization: this.speechPolishDebug.normalization.map((item) => ({ ...item })),
      audioBoundaries: this.speechPolishDebug.audioBoundaries.map((item) => ({ ...item })),
    }
  }

  async synthesizeSegment(
    turnId: string,
    segment: EmotionTextSegment,
  ): Promise<SuccessfulSpeechReply> {
    const speech = await window.api.tts.synthesizeReply(turnId, segment.text, segment.emotion)
    if (!speech.ok || !speech.audioBuffer) {
      if (speech.errorCode) throw speechErrorFromResponse('synthesis', speech)
      throw new Error(speech.error ?? 'No audio')
    }
    const successfulSpeech = speech as SuccessfulSpeechReply
    this.recordSpeechPolishTelemetry(turnId, segment.index, successfulSpeech)
    return successfulSpeech
  }

  hasSpeakableContent(text: string): boolean {
    return hasSpeakableContent(text)
  }

  async createDebugSpeechTurn(turnId: string, emotionKey = 'happy'): Promise<DebugSpeechTurn> {
    const text = `[${emotionKey}] Тестирую полный цикл Shio.`
    const speech = await window.api.tts.synthesizeReply(turnId, text, emotionKey)
    if (!speech.ok || !speech.audioBuffer) {
      if (speech.errorCode) throw speechErrorFromResponse('synthesis', speech)
      throw new Error(speech.error ?? 'нет аудио')
    }
    const successfulSpeech = speech as SuccessfulSpeechReply
    this.recordSpeechPolishTelemetry(turnId, 0, successfulSpeech)

    return {
      text,
      emotionKey,
      speech: successfulSpeech,
      ttsLatencyText: this.formatTtsLatency(successfulSpeech),
    }
  }

  async recognizeSpeech(wavBuffer: ArrayBuffer): Promise<RecognizedSpeech> {
    const res = await window.api.asr.recognize(wavBuffer)
    if (!res.ok || !res.text) {
      if (res.errorCode) throw speechErrorFromResponse('recognition', res)
      throw new Error(res.error ?? 'No text')
    }

    return { text: res.text }
  }

  private formatTtsLatency(speech: SpeechReply): string | null {
    const value = Number(speech.latencyMs)
    if (!Number.isFinite(value) || value < 0) return null

    const cacheState = (speech.cache ?? '').toUpperCase()
    if (cacheState === 'HIT') {
      const generated = Number(speech.generatedLatencyMs)
      const generatedText =
        Number.isFinite(generated) && generated > 0
          ? `, генерация была ${Math.round(generated)} мс`
          : ''
      return `TTS: ${Math.round(value)} мс (кэш${generatedText})`
    }
    if (cacheState === 'MISS') return `TTS: ${Math.round(value)} мс (miss)`
    if (cacheState === 'SKIP') return `TTS: ${Math.round(value)} мс (без кэша)`
    return `TTS: ${Math.round(value)} мс`
  }

  private recordSpeechPolishTelemetry(
    turnId: string,
    segmentIndex: number,
    speech: {
      normalization?: SpeechTextNormalizationTelemetry
      audioBoundaries?: SpeechAudioBoundaryTelemetry
    },
  ): void {
    if (this.speechPolishTurnId !== turnId) {
      this.speechPolishTurnId = turnId
      this.speechPolishDebug = { normalization: [], audioBoundaries: [] }
    }
    if (speech.normalization) {
      const normalization = { ...speech.normalization }
      const items = [...this.speechPolishDebug.normalization]
      items[segmentIndex] = normalization
      this.speechPolishDebug.normalization = items.slice(0, 3)
      this.events.publish({
        type: 'Speech Text Normalized',
        category: 'speech',
        source: 'renderer.speechRuntime',
        detail: [
          `turnId=${turnId}`,
          `segmentIndex=${segmentIndex}`,
          `normalizationVersion=${normalization.version}`,
          `ruleCount=${normalization.appliedRuleCount}`,
          `inputCharacters=${normalization.inputCharacters}`,
          `outputCharacters=${normalization.outputCharacters}`,
        ].join(' '),
        metadata: {
          turnId,
          segmentIndex,
          normalizationVersion: normalization.version,
          ruleCount: normalization.appliedRuleCount,
          inputCharacters: normalization.inputCharacters,
          outputCharacters: normalization.outputCharacters,
        },
      })
    }
    if (speech.audioBoundaries) {
      const boundaries = { ...speech.audioBoundaries }
      const items = [...this.speechPolishDebug.audioBoundaries]
      items[segmentIndex] = boundaries
      this.speechPolishDebug.audioBoundaries = items.slice(0, 3)
      this.events.publish({
        type: 'Speech Audio Boundary Processed',
        category: 'speech',
        source: 'renderer.speechRuntime',
        detail: [
          `turnId=${turnId}`,
          `segmentIndex=${segmentIndex}`,
          `boundaryProfile=${boundaries.profile}`,
          `leadingSilenceMs=${boundaries.leadingSilenceMs}`,
          `trailingSilenceMs=${boundaries.trailingSilenceMs}`,
          `trimmedLeadingMs=${boundaries.trimmedLeadingMs}`,
          `trimmedTrailingMs=${boundaries.trimmedTrailingMs}`,
          `fadeInMs=${boundaries.fadeInMs}`,
          `fadeOutMs=${boundaries.fadeOutMs}`,
          `postprocessMs=${boundaries.postprocessMs}`,
        ].join(' '),
        metadata: {
          turnId,
          segmentIndex,
          boundaryProfile: boundaries.profile,
          leadingSilenceMs: boundaries.leadingSilenceMs,
          trailingSilenceMs: boundaries.trailingSilenceMs,
          trimmedLeadingMs: boundaries.trimmedLeadingMs,
          trimmedTrailingMs: boundaries.trimmedTrailingMs,
          fadeInMs: boundaries.fadeInMs,
          fadeOutMs: boundaries.fadeOutMs,
          postprocessMs: boundaries.postprocessMs,
        },
      })
    }
  }

  private recordSpeechTimeline(
    from: CharacterSpeechState,
    to: CharacterSpeechState,
    mode: CharacterRuntimeMode,
    emotion: string,
  ): void {
    if (from === to) return
    const at = Date.now()
    const entry: SpeechStateTimelineEntry = {
      at,
      from,
      to,
      mode,
      durationMs: this.lastSpeechTransitionAt === null ? null : at - this.lastSpeechTransitionAt,
      emotion,
    }
    this.lastSpeechTransitionAt = at
    this.speechTimeline = [...this.speechTimeline, entry].slice(-40)
    console.log(
      `[SPEECHSTATE] ${from}->${to} mode=${mode} emotion=${emotion} durationMs=${entry.durationMs ?? 'n/a'}`,
    )
  }
}
