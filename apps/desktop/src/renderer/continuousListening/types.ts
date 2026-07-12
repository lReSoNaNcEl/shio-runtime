export type AttentionMode = 'silent' | 'passive' | 'active' | 'streamer'

export type ConversationInputSource =
  | 'text_chat'
  | 'push_to_talk'
  | 'continuous_listening'
  | 'backlog_selected'
  | 'debug'

export interface ConversationInput {
  turnId: string
  text: string
  source: ConversationInputSource
  createdAt: number
  streamingSessionId?: string
  utteranceIds?: string[]
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
    }
  | { status: 'cancelled'; turnId: string }

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
}

export type BacklogPriorityClass = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'

export interface BufferedUtterance {
  id: string
  text: string
  createdAt: number
  expiresAt: number
  streamingSessionId: string
  segmentId?: string
  directAddress: boolean
  question: boolean
  correctionHint: boolean
  followUpHint: boolean
  attentionScore: number
  attentionMode: AttentionMode
  capturedWhileShioBusy: boolean
  capturedDuringPlayback: boolean
  likelySelfEcho: boolean
  priorityClass: BacklogPriorityClass
}

export interface BacklogSelectionResult {
  action: 'select' | 'merge' | 'discard_all'
  selectedIds: string[]
  text?: string
  reason: string
  confidence: number
  backlogVersion: number
}

export interface AttentionDecision {
  shouldAttend: boolean
  score: number
  threshold: number
  reasons: string[]
  mode: AttentionMode
  directAddress: boolean
}

export type RuleGateDecision =
  | { type: 'ignore'; reason: string }
  | { type: 'llm'; userText: string; reason: string }
  | { type: 'backlog'; userText: string; reason: string }

export interface ContinuousListeningSettings {
  enabled: boolean
  mode: AttentionMode
  replyCooldownMs: number
  followUpWindowMs: number
  curiosityChance: number
}
