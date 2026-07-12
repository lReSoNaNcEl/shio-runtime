import type { AvatarRuntimeDebugState } from './AvatarRuntime'
import type { RuntimeHealth } from './RuntimeStateInvariantValidator'

interface RecorderFrame {
  at: number
  frame: number
  reason?: string
  avatar: AvatarRuntimeDebugState
  runtimeHealth: RuntimeHealth | null
}

interface PendingCapture {
  id: number
  reason: string
  startedAtFrame: number
  remainingFutureFrames: number
  frames: RecorderFrame[]
}

export class TransitionRecorder {
  private history: RecorderFrame[] = []
  private pending: PendingCapture | null = null
  private seq = 0
  private lastOwnershipGapCount = 0
  private lastViolationCount = 0
  private lastWriteAt = 0

  observe(frame: number, avatar: AvatarRuntimeDebugState, runtimeHealth: RuntimeHealth | null): void {
    const snapshot: RecorderFrame = {
      at: Date.now(),
      frame,
      avatar,
      runtimeHealth
    }
    this.history = [...this.history, snapshot].slice(-60)

    const reason = this.detectReason(avatar, runtimeHealth)
    if (reason) this.trigger(reason, snapshot)

    if (!this.pending) return
    this.pending.frames.push(snapshot)
    this.pending.remainingFutureFrames -= 1
    if (this.pending.remainingFutureFrames <= 0) void this.flush()
  }

  private detectReason(avatar: AvatarRuntimeDebugState, runtimeHealth: RuntimeHealth | null): string | null {
    const body = avatar.bodyActions
    const hipsJump = Math.abs(body.hipsDeltaY) > 0.1
    if (hipsJump) return `hips jump ${body.hipsDeltaY.toFixed(3)} during ${body.lastLoadAnimationId ?? 'none'}`

    if (body.ownershipGapCount > this.lastOwnershipGapCount) {
      this.lastOwnershipGapCount = body.ownershipGapCount
      return `ownership gap count ${body.ownershipGapCount}`
    }

    const violationCount = runtimeHealth?.totalViolations ?? 0
    if (violationCount > this.lastViolationCount) {
      this.lastViolationCount = violationCount
      return runtimeHealth?.lastViolation
        ? `runtime invariant ${runtimeHealth.lastViolation.id}: ${runtimeHealth.lastViolation.detail}`
        : `runtime invariant violation count ${violationCount}`
    }

    return null
  }

  private trigger(reason: string, snapshot: RecorderFrame): void {
    const now = Date.now()
    if (this.pending || now - this.lastWriteAt < 1500) return
    this.pending = {
      id: ++this.seq,
      reason,
      startedAtFrame: snapshot.frame,
      remainingFutureFrames: 60,
      frames: [...this.history, { ...snapshot, reason }]
    }
  }

  private async flush(): Promise<void> {
    const capture = this.pending
    if (!capture) return
    this.pending = null
    this.lastWriteAt = Date.now()
    const payload = {
      schema: 'shio.transition-recording.v1',
      id: capture.id,
      reason: capture.reason,
      startedAtFrame: capture.startedAtFrame,
      savedAt: new Date().toISOString(),
      frames: capture.frames
    }
    try {
      const result = await window.api.debug.writeTransitionRecording(payload)
      if (result.ok) {
        console.log(`[TRANSITIONREC] saved reason="${capture.reason}" file=${result.filePath ?? 'unknown'}`)
      }
    } catch (error) {
      console.warn('[TRANSITIONREC] failed to save transition recording', error)
    }
  }
}
