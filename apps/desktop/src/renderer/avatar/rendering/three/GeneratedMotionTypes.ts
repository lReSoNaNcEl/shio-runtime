import type {
  BodyTurnIntent,
  GeneratedMotionHealth,
  MotionPhaseId,
} from '../../../../shared/motion'
import type { AvatarBodyMotionLayer } from '../../embodiment/motion/AvatarMotionLayer'
import type { MotionLibraryDebug } from '../../MotionLibraryDebug'

export interface GeneratedMotionRequestContext {
  seed?: number
  animationId: string
  speechBound?: boolean
  blendDuration?: number
  behaviorId: string
  source: string
  reason: string
  previousAnimationId: string | null
  forceReplay: boolean
  frame?: number
  motionLayer: AvatarBodyMotionLayer
  bodyAction?: BodyTurnIntent
}

/** Bounded metadata from the single body owner; never poses or synthetic clips. */
export interface GeneratedBodyDebugState {
  motionExecution: MotionLibraryDebug
  generated: GeneratedMotionHealth
  generatedTrace: ReadonlyArray<{
    at: number
    profileId: string
    phase: string
    sourceFrame: number
    sourceSampleOffset: number | null
    queueFrames: number
    lateChunks: number
  }>
  presentationMode: 'primary' | 'mirror'
  appliedPose: {
    profileId: string
    executionId: string | null
    phaseId: MotionPhaseId | null
    sourceFrame: number
    outcome: MotionLibraryDebug['outcome']
  } | null
  activeExecutionCount: number
  poseOwnerCount: number
  avatarGeneration: number
  executionsStarted: number
  sourceTimeSeconds: number
  transitionDuration: number
  transitionRemaining: number
  hipsDeltaY: number
  maxHipsDeltaY: number
}

export interface VrmPerformanceDebugState {
  avatarFps: number
}
