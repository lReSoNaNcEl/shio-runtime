export const LATENCY_MILESTONES = [
  'input_received',
  'utterance_completed',
  'text_submitted',
  'admission_requested',
  'turn_admitted',
  'speech_started',
  'speech_ended',
  'asr_final',
  'llm_request_started',
  'llm_connected',
  'llm_first_byte',
  'llm_first_text_delta',
  'llm_first_sentence',
  'llm_completed',
  'tool_round_started',
  'tool_round_completed',
  'tts_segment_requested',
  'tts_queue_entered',
  'tts_execution_started',
  'tts_execution_completed',
  'audio_preparation_started',
  'audio_preparation_completed',
  'audio_ready',
  'tts_segment_ready',
  'first_audio_ready',
  'playback_started',
  'playback_completed',
  'turn_terminal',
] as const

export type LatencyMilestoneName = (typeof LATENCY_MILESTONES)[number]

export interface LatencyCorrelation {
  turnId: string
  requestId: string
  llmRound: number
  toolCallId?: string
  ttsSegmentId?: string
  goalId?: string
}

export interface LatencyMilestone {
  name: LatencyMilestoneName
  at: number
  correlation: LatencyCorrelation
  status?: 'started' | 'success' | 'failure' | 'cancelled' | 'timeout'
  provider?: string
  model?: string
  metadata?: Readonly<{
    workerId?: string
    characters?: number
    words?: number
  }>
}

export type LatencyMetricName =
  | 'asrFinal'
  | 'llmConnect'
  | 'llmTtft'
  | 'llmFirstSentence'
  | 'llmTotal'
  | 'toolRound'
  | 'ttsSynthesis'
  | 'ttsQueueWait'
  | 'ttsExecution'
  | 'audioPreparation'
  | 'audioReadyToPlaybackStart'
  | 'firstAudio'
  | 'timeToPlayback'
  | 'fullTurn'

export interface LatencyMetricSummary {
  count: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

export interface LatencyTraceSnapshot {
  turnId: string
  requestId: string
  goalId?: string
  provider?: string
  model?: string
  status?: LatencyMilestone['status']
  startedAt: number
  terminalAt?: number
  milestones: readonly LatencyMilestone[]
}

export interface LatencySnapshot {
  capturedAt: number
  metrics: Readonly<Partial<Record<LatencyMetricName, LatencyMetricSummary>>>
  recentTraces: readonly LatencyTraceSnapshot[]
}
