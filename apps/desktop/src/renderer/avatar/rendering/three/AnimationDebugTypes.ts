import type { VrmRootMotionPolicy } from './VrmAnimationTypes'

export interface VrmBodyActionDebugEntry {
  name: string
  actionInstanceId: number
  clipInstanceId: number
  weight: number
  time: number
  duration: number
  enabled: boolean
  running: boolean
  fadingOut: boolean
  current: boolean
  previous: boolean
}

export interface VrmBodyActionDebugState {
  activeActionCount: number
  weightedActionCount: number
  currentClipName: string | null
  currentClipDuration: number | null
  currentClipTime: number | null
  transitionRemaining: number
  rootMotionPolicy: VrmRootMotionPolicy
  hipsDeltaY: number
  rootDeltaY: number
  maxHipsDeltaY: number
  maxRootDeltaY: number
  lastLoadSource: string
  lastLoadReason: string
  lastLoadAnimationId: string | null
  lastLoadFile: string | null
  restartCount: number
  ownershipGapCount: number
  lastTransitionEvent: string
  clipCache: {
    loads: number
    reuses: number
    hits: number
    misses: number
    parses: number
  }
  facialControlTracksDisabled: number
  facialControlTrackNames: string[]
  frameTrace: VrmTransitionFrameTraceEntry[]
  actions: VrmBodyActionDebugEntry[]
}

export interface VrmPerformanceDebugState {
  avatarFps: number
}

export interface VrmTransitionFrameTraceEntry {
  at: number
  frame: number
  label: string
  animationId: string | null
  previousAnimationId: string | null
  mixerActionCount: number
  bodyActionCount: number
  weightedActionCount: number
  totalEffectiveWeight: number
  hasWeightGap: boolean
  hasZeroWeightedActions: boolean
  currentActionInfluential: boolean
  currentWeight: number
  previousWeight: number
  transitionRemaining: number
  cleanupState: string
  localRootQuaternion: string
  hipsQuaternion: string
  firstBoneChangeAfterPlayFrame: number | null
  framesSincePlayWithoutBoneChange: number | null
  hipsDeltaY: number
  rootDeltaY: number
  mixerActions: VrmBodyActionDebugEntry[]
  actions: VrmBodyActionDebugEntry[]
}
