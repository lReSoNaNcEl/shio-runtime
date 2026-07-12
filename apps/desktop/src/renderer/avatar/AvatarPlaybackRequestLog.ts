export type AvatarPlaybackRequestSource =
  | 'character-state'
  | 'state-effect'
  | 'idle-orchestrator'
  | 'speaking-gesture-scheduler'
  | 'queue'
  | 'debug-preview'
  | 'debug-reroll'
  | 'external'
  | 'fallback'

export interface AvatarPlaybackRequestLogEntry {
  id: number
  frame: number
  animationId: string
  behaviorId: string
  source: AvatarPlaybackRequestSource
  reason: string
  accepted: boolean
  decision: 'play' | 'queue' | 'discard' | 'ignored'
  rejectionReason: string | null
  currentAnimationId: string | null
  requestedAnimationId: string | null
  transitionPolicy: string
  transitionPending: boolean
}

export interface AvatarPlaybackRequestDebugState {
  currentAnimation: string | null
  requestedAnimation: string | null
  currentTransition: string
  transitionPending: boolean
  replayCount: number
  ignoredDuplicateRequests: number
  requests: AvatarPlaybackRequestLogEntry[]
}

export class AvatarPlaybackRequestLog {
  private seq = 0
  private replayCount = 0
  private ignoredDuplicateRequests = 0
  private entries: AvatarPlaybackRequestLogEntry[] = []

  record(input: Omit<AvatarPlaybackRequestLogEntry, 'id'>): AvatarPlaybackRequestLogEntry {
    const entry = { ...input, id: ++this.seq }
    if (entry.accepted && entry.currentAnimationId === entry.requestedAnimationId) this.replayCount += 1
    if (!entry.accepted && entry.rejectionReason === 'already active') this.ignoredDuplicateRequests += 1
    this.entries = [...this.entries, entry].slice(-40)
    console.log(
      `[PLAYBACKREQ] frame=${entry.frame} animation=${entry.animationId} behavior=${entry.behaviorId} source=${entry.source} accepted=${entry.accepted} decision=${entry.decision} reason="${entry.reason}" reject="${entry.rejectionReason ?? 'none'}"`
    )
    return entry
  }

  getDebugState(input: {
    currentAnimation: string | null
    requestedAnimation: string | null
    currentTransition: string
    transitionPending: boolean
  }): AvatarPlaybackRequestDebugState {
    return {
      ...input,
      replayCount: this.replayCount,
      ignoredDuplicateRequests: this.ignoredDuplicateRequests,
      requests: [...this.entries]
    }
  }
}
