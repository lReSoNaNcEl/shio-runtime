import type {
  SpeechAudioBoundaryTelemetry,
  SpeechTextNormalizationTelemetry,
  SpeechUtteranceKind,
} from '../../../shared/speech'

export type { SpeechAudioBoundaryTelemetry, SpeechTextNormalizationTelemetry, SpeechUtteranceKind }

export type SpeechTextNormalizationCategory =
  | 'markdown'
  | 'technical-term'
  | 'abbreviation'
  | 'url'
  | 'path'
  | 'version'
  | 'code'
  | 'list'
  | 'nonverbal'

export interface SpeechTextRepresentations {
  replyText: string
  displayText: string
  speechText: string
  normalizedSpeechText: string
}

export interface SpeechTextNormalizationInput {
  text: string
  language: string
}

export interface SpeechTextNormalizationDiagnostics {
  version: string
  changed: boolean
  inputCharacters: number
  outputCharacters: number
  appliedRuleIds: string[]
  categories: SpeechTextNormalizationCategory[]
  fallbackReason?: 'empty-output' | 'expansion-limit' | 'idempotence' | 'invariant'
}

export interface SpeechTextNormalizationResult {
  text: string
  utteranceKind: SpeechUtteranceKind
  diagnostics: SpeechTextNormalizationDiagnostics
}

export interface SpeechTextNormalizationLimits {
  expansionFactor?: number
  expansionAllowance?: number
}
