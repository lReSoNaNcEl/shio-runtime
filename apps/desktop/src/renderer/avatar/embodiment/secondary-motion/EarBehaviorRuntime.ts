import type { AvatarProceduralMode } from '../types'

/** Semantic ear impulses and bounded S22 secondary motion diagnostics. */
export type EarBehaviorProfile = AvatarProceduralMode | 'afk'
export type EarSide = 'left' | 'right' | 'center'
export type EarGestureId =
  | 'relaxed'
  | 'perk'
  | 'curious'
  | 'tilt'
  | 'flatten'
  | 'emphasis'
  | 'droop'
export type EarAxisOverride = 'auto' | 'x' | 'y' | 'z'
export type EarImpulse =
  | 'user-interruption'
  | 'direct-address'
  | 'question'
  | 'thinking-entry'
  | 'reply-emphasis'
  | 'recognition-uncertain'

export interface EarPose {
  lift: number
  spread: number
}

export interface EarDebugState {
  boneName: string
  detectedAxis: string
  restPose: string
  pose: EarGestureId
  basePose: EarPose
  speakingModifier: EarPose
  finalPose: EarPose
  currentLift: number
  currentSpread: number
  targetLift: number
  targetSpread: number
  currentRotationRad: number
  targetRotationRad: number
  nextEventMs: number
}

export interface EarBehaviorDebugState {
  enabled: boolean
  boneStatus: string
  profile: EarBehaviorProfile
  emotion: string
  axisOverride: EarAxisOverride
  amplitudeScale: number
  idleMs: number
  updateTickCount: number
  lastDeltaMs: number
  activeImpulse: EarImpulse | null
  left: EarDebugState | null
  right: EarDebugState | null
}
