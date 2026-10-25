export type CharacterStreamFinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'error'
  | 'unknown'

export interface CharacterStreamToolCall {
  id: string
  name: string
  argumentsJson: string
}

export interface CharacterStreamUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type CharacterStreamEvent =
  | { type: 'connected'; at: number }
  | { type: 'first-byte'; at: number }
  | { type: 'text-delta'; at: number; text: string }
  | { type: 'tool-call-start'; at: number; index: number; id: string; name: string }
  | {
      type: 'tool-call-delta'
      at: number
      index: number
      id: string
      nameDelta?: string
      argumentsDelta?: string
    }
  | { type: 'tool-call-complete'; at: number; index: number; call: CharacterStreamToolCall }
  | { type: 'usage'; at: number; usage: CharacterStreamUsage }
  | { type: 'completed'; at: number; finishReason: CharacterStreamFinishReason }

export interface CharacterStreamDeadlines {
  connectionMs: number
  firstByteMs: number
  idleMs: number
  totalMs: number
}

export interface SafeCharacterTextDelta {
  text: string
  emotion: string
  voiceStyle?: string
}

export interface SpeechTextCommit {
  id: string
  turnId: string
  text: string
  emotion: string
  voiceStyle?: string
  sequence: number
  boundary: 'clause' | 'sentence' | 'hard-limit' | 'final' | 'emotion'
}

export type CharacterReplyStreamEvent =
  | {
      type: 'connected' | 'first-byte'
      turnId: string
      requestId: string
      at: number
      llmRound: number
    }
  | {
      type: 'text-delta'
      turnId: string
      requestId: string
      at: number
      llmRound: number
      delta: SafeCharacterTextDelta
    }
  | {
      type: 'tool-round-started' | 'tool-round-completed'
      turnId: string
      requestId: string
      at: number
      llmRound: number
    }
  | {
      type: 'completed'
      turnId: string
      requestId: string
      at: number
      llmRound: number
    }

export function characterRequestId(turnId: string): string {
  return `request:${turnId}`
}
