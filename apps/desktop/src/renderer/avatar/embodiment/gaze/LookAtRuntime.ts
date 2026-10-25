export type LookAtMode =
  | 'idle'
  | 'speaking'
  | 'listening'
  | 'thinking'
  | 'userFocus'
  | 'screenFocus'
  | 'away'
export type LookAtTargetKind =
  | 'none'
  | 'camera'
  | 'idleOffset'
  | 'thinkingOffset'
  | 'conversationFocus'
  | 'screenContext'
  | 'replyAway'

export interface LookAtDebugState {
  mode: LookAtMode
  target: LookAtTargetKind
  eyeYaw: number
  eyePitch: number
  nextSaccadeMs: number
  thinkingTimerMs: number
  returnProgress: number
  focusHoldMs: number
  overshootMs: number
  microSaccade: { yaw: number; pitch: number }
  headLagMs: number
}
