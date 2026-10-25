export type HeadMotionProfile = 'idle' | 'listening' | 'thinking' | 'speaking' | 'userFocus'
export type HeadAttentionImpulse = 'user-interruption'
export type HeadMotionGeneratorId =
  | 'idleDrift'
  | 'microTilt'
  | 'slowYaw'
  | 'speakingNod'
  | 'listeningTilt'
  | 'thinkingDrift'

export interface HeadMotionPose {
  yaw: number
  pitch: number
  roll: number
}

export interface HeadMotionDebugState {
  profile: HeadMotionProfile
  activeGenerators: HeadMotionGeneratorId[]
  yawOffset: number
  pitchOffset: number
  rollOffset: number
  motionEnergy: number
  currentBlend: number
  generatorWeights: Record<HeadMotionGeneratorId, number>
  smoothing: number
  nextProceduralEventMs: number
  attentionImpulseActive: boolean
  authorityWeight: number
}
