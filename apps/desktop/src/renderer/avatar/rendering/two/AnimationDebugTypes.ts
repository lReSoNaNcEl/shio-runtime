export interface AvatarBodyActionDebugState {
  activeActionCount: number
  weightedActionCount: number
  currentClipName: string | null
  currentClipDuration: number | null
  currentClipTime: number | null
  transitionRemaining: number
  lastLoadSource: string
  lastLoadReason: string
  lastLoadAnimationId: string | null
  lastLoadFile: string | null
  restartCount: number
  ownershipGapCount: number
  lastTransitionEvent: string
}
export interface AvatarPerformanceDebugState {
  avatarFps: number
}
