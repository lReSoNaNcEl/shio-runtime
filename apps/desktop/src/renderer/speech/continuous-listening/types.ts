export type {
  BacklogPriorityClass,
  BacklogSelectionResult,
  BufferedUtterance,
} from '../../../shared/conversation'

import type { ConversationTurnFailure } from '../../../shared/conversation'

export type ConversationInputSource =
  | 'text_chat'
  | 'push_to_talk'
  | 'continuous_listening'
  | 'backlog_selected'
  | 'autonomous_initiative'
  | 'debug'

export interface ConversationInput {
  turnId: string
  text: string
  source: ConversationInputSource
  /** Allowed only for text_chat; all speech, backlog, and debug paths omit it. */
  screenContextId?: string
  createdAt: number
  streamingSessionId?: string
  utteranceIds?: string[]
  triggeredBargeIn?: boolean
  semanticCues?: {
    directAddress: boolean
    question: boolean
    recognitionUncertain: boolean
  }
}

export interface AdmittedConversationTurn extends ConversationInput {
  admissionCycleId: string
}

export type ConversationExecutionPhase = 'generating' | 'synthesizing' | 'playing' | 'cleaning_up'

export interface ActiveConversationExecution {
  turnId: string
  admissionCycleId: string
  phase: ConversationExecutionPhase
  startedAt: number
}

export type ConversationCompletionResult =
  | { status: 'completed'; turnId: string; playbackCompleted: boolean; cleanupCompleted: true }
  | {
      status: 'failed'
      turnId: string
      phase: 'generation' | 'synthesis' | 'playback' | 'cleanup'
      error: string
      failure?: ConversationTurnFailure
    }
  | { status: 'cancelled'; turnId: string }

export type ChatSubmissionResult =
  | { status: 'completed' }
  | {
      status: 'failed'
      failure: ConversationTurnFailure
    }
  | { status: 'cancelled' }

export type ChunkCompletionReason = 'asr_final' | 'vad_pause' | 'timeout' | 'max_length'

export interface UtteranceChunk {
  id: string
  text: string
  startedAt: number
  completedAt: number
  completionReason: ChunkCompletionReason
  confidence?: number
  streamingSessionId?: string
  segmentId?: string
  capturedDuringPlayback?: boolean
  triggeredBargeIn?: boolean
}

export interface AttentionDecision {
  shouldAttend: boolean
  score: number
  threshold: number
  reasons: string[]
  directAddress: boolean
}

export type RuleGateDecision =
  | { type: 'ignore'; reason: string }
  | { type: 'llm'; userText: string; reason: string }
  | { type: 'backlog'; userText: string; reason: string }

export interface ContinuousListeningSettings {
  enabled: boolean
  replyCooldownMs: number
  followUpWindowMs: number
  curiosityChance: number
}
