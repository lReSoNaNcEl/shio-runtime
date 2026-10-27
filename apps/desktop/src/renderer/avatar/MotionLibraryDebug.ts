import type { MotionPhaseId } from '../../shared/motion'

export interface MotionLibraryDebug {
  profileId: string | null
  runningProfileId: string | null
  posture: 'standing'
  phase: MotionPhaseId | null
  handPhase: MotionPhaseId | null
  transitionRoute: string[]
  rejectedReason: string | null
  profiles: Record<string, { available: boolean; reason: string | null }>
  executionId: string | null
  outcome: 'completed' | 'superseded' | 'cancelled' | 'timed-out' | 'failed' | null
  blendRemaining: number
  underruns: number
}
