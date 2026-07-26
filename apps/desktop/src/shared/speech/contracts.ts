export type SpeechUtteranceKind = 'normal' | 'technical' | 'nonverbal' | 'short-interjection'

export interface SpeechTextNormalizationTelemetry {
  version: string
  changed: boolean
  inputCharacters: number
  outputCharacters: number
  appliedRuleCount: number
  categories: string[]
}

export interface SpeechAudioBoundaryTelemetry {
  profile: string
  leadingSilenceMs: number
  trailingSilenceMs: number
  trimmedLeadingMs: number
  trimmedTrailingMs: number
  fadeInMs: number
  fadeOutMs: number
  postprocessMs: number
}

export interface SpeechPolishDebugState {
  normalization: SpeechTextNormalizationTelemetry[]
  audioBoundaries: SpeechAudioBoundaryTelemetry[]
}
