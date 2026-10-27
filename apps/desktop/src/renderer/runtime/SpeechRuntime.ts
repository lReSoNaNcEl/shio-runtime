import type {
  CharacterRuntimeMode,
  CharacterSpeechState,
  CharacterState,
} from '../../shared/runtime'
import type { SpeechPolishDebugState } from '../../shared/speech'
import { hasSpeakableContent } from '../../shared/speech'
import { speechErrorFromResponse } from './speechCapabilities'

export interface SpeechStateTimelineEntry {
  at: number
  from: CharacterSpeechState
  to: CharacterSpeechState
  mode: CharacterRuntimeMode
  durationMs: number | null
  emotion: string
}

export interface RecognizedSpeech {
  text: string
}

export class SpeechRuntime {
  private speechTimeline: SpeechStateTimelineEntry[] = []
  private lastSpeechTransitionAt: number | null = null

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
    return { normalization: [], audioBoundaries: [] }
  }

  hasSpeakableContent(text: string): boolean {
    return hasSpeakableContent(text)
  }

  async recognizeSpeech(wavBuffer: ArrayBuffer): Promise<RecognizedSpeech> {
    const response = await window.api.asr.recognize(wavBuffer)
    if (!response.ok || !response.text) {
      if (response.errorCode) throw speechErrorFromResponse('recognition', response)
      throw new Error(response.error ?? 'No text')
    }
    return { text: response.text }
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
  }
}
