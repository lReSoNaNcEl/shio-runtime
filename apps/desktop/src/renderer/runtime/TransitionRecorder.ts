import { TRANSITION_RECORDING_MAX_BYTES } from '../../shared/diagnostics'
import type { AvatarRuntimeDebugState } from './AvatarRuntime'
import type { RuntimeHealth } from './RuntimeStateInvariantValidator'

const HISTORY_FRAME_COUNT = 60
const FUTURE_FRAME_COUNT = 60
const RECORDER_FRAME_TARGET_BYTES = 32_000
const RECORDER_TEXT_LIMIT = 500

type TransitionRecordingWriteResult = {
  ok: boolean
  filePath?: string
  error?: string
}

type TransitionRecordingWriter = (payload: unknown) => Promise<TransitionRecordingWriteResult>

interface RecorderFrame {
  at: number
  frame: number
  reason?: string
  avatar: Record<string, unknown>
  runtimeHealth: Record<string, unknown> | null
}

interface PendingCapture {
  id: number
  reason: string
  startedAtFrame: number
  remainingFutureFrames: number
  frames: RecorderFrame[]
}

interface TransitionRecordingPayload {
  schema: 'shio.transition-recording.v1'
  id: number
  reason: string
  startedAtFrame: number
  savedAt: string
  frames: RecorderFrame[]
}

function serializedSizeAtMost(value: unknown, maximumBytes: number): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maximumBytes
  } catch {
    return false
  }
}

function truncate(value: string | null, maximumLength = RECORDER_TEXT_LIMIT): string | null {
  if (value === null || value.length <= maximumLength) return value
  return value.slice(0, maximumLength)
}

function createDetailedAvatarSnapshot(avatar: AvatarRuntimeDebugState): Record<string, unknown> {
  return {
    ...avatar,
    bodyActions: {
      ...avatar.bodyActions,
      frameTrace: avatar.bodyActions.frameTrace.slice(-1),
    },
    playbackRequests: {
      ...avatar.playbackRequests,
      requests: avatar.playbackRequests.requests.slice(-1),
    },
    behaviorTimeline: avatar.behaviorTimeline.slice(-1),
  }
}

function createEssentialAvatarSnapshot(avatar: AvatarRuntimeDebugState): Record<string, unknown> {
  const body = avatar.bodyActions
  return {
    mode: avatar.mode,
    emotionKey: truncate(avatar.emotionKey),
    currentBodyAnimation: truncate(avatar.currentBodyAnimation),
    currentBodyAnimationFile: truncate(avatar.currentBodyAnimationFile),
    currentBodyAnimationLoop: avatar.currentBodyAnimationLoop,
    currentBodyAnimationStatus: avatar.currentBodyAnimationStatus,
    previousBodyAnimation: truncate(avatar.previousBodyAnimation),
    activeTransitionPolicy: truncate(avatar.activeTransitionPolicy),
    activeBlendDuration: avatar.activeBlendDuration,
    currentBehaviorId: truncate(avatar.currentBehaviorId),
    behaviorSelectionReason: truncate(avatar.behaviorSelectionReason),
    selectedBehaviorAnimation: truncate(avatar.selectedBehaviorAnimation),
    currentGesture: truncate(avatar.currentGesture),
    scheduledAnimationKey: truncate(avatar.scheduledAnimationKey),
    bodyActions: {
      activeActionCount: body.activeActionCount,
      weightedActionCount: body.weightedActionCount,
      currentClipName: truncate(body.currentClipName),
      currentClipDuration: body.currentClipDuration,
      currentClipTime: body.currentClipTime,
      transitionRemaining: body.transitionRemaining,
      hipsDeltaY: body.hipsDeltaY,
      rootDeltaY: body.rootDeltaY,
      maxHipsDeltaY: body.maxHipsDeltaY,
      maxRootDeltaY: body.maxRootDeltaY,
      lastLoadSource: truncate(body.lastLoadSource),
      lastLoadReason: truncate(body.lastLoadReason),
      lastLoadAnimationId: truncate(body.lastLoadAnimationId),
      restartCount: body.restartCount,
      ownershipGapCount: body.ownershipGapCount,
      lastTransitionEvent: truncate(body.lastTransitionEvent),
    },
    playbackRequests: {
      currentAnimation: truncate(avatar.playbackRequests.currentAnimation),
      requestedAnimation: truncate(avatar.playbackRequests.requestedAnimation),
      currentTransition: truncate(avatar.playbackRequests.currentTransition),
      transitionPending: avatar.playbackRequests.transitionPending,
      replayCount: avatar.playbackRequests.replayCount,
      ignoredDuplicateRequests: avatar.playbackRequests.ignoredDuplicateRequests,
    },
  }
}

function createEssentialRuntimeHealthSnapshot(
  runtimeHealth: RuntimeHealth | null,
): Record<string, unknown> | null {
  if (!runtimeHealth) return null
  return {
    enabled: runtimeHealth.enabled,
    frame: runtimeHealth.frame,
    evaluatedAt: runtimeHealth.evaluatedAt,
    passCount: runtimeHealth.passCount,
    failCount: runtimeHealth.failCount,
    skipCount: runtimeHealth.skipCount,
    totalViolations: runtimeHealth.totalViolations,
    lastViolation: runtimeHealth.lastViolation
      ? {
          ...runtimeHealth.lastViolation,
          detail: truncate(runtimeHealth.lastViolation.detail),
          suspectedOwner: truncate(runtimeHealth.lastViolation.suspectedOwner),
        }
      : null,
  }
}

function createRecorderFrame(
  frame: number,
  avatar: AvatarRuntimeDebugState,
  runtimeHealth: RuntimeHealth | null,
): RecorderFrame {
  const detailed: RecorderFrame = {
    at: Date.now(),
    frame,
    avatar: createDetailedAvatarSnapshot(avatar),
    runtimeHealth: runtimeHealth ? { ...runtimeHealth } : null,
  }
  if (serializedSizeAtMost(detailed, RECORDER_FRAME_TARGET_BYTES)) return detailed
  return {
    at: detailed.at,
    frame,
    avatar: createEssentialAvatarSnapshot(avatar),
    runtimeHealth: createEssentialRuntimeHealthSnapshot(runtimeHealth),
  }
}

function downsampleFrames(frames: RecorderFrame[]): RecorderFrame[] {
  if (frames.length <= 2) return frames
  const lastIndex = frames.length - 1
  const sampled = frames.filter(
    (frame, index) => index === 0 || index === lastIndex || frame.reason || index % 2 === 0,
  )
  if (sampled.length < frames.length) return sampled

  const reasonFrame = frames.find((frame) => frame.reason)
  return reasonFrame && reasonFrame !== frames[0] && reasonFrame !== frames[lastIndex]
    ? [frames[0], reasonFrame, frames[lastIndex]]
    : [frames[0], frames[lastIndex]]
}

function fitRecordingToBudget(payload: TransitionRecordingPayload): TransitionRecordingPayload {
  let frames = payload.frames
  let boundedPayload = payload
  while (!serializedSizeAtMost(boundedPayload, TRANSITION_RECORDING_MAX_BYTES)) {
    const sampled = downsampleFrames(frames)
    if (sampled.length >= frames.length) break
    frames = sampled
    boundedPayload = { ...payload, frames }
  }
  return boundedPayload
}

export class TransitionRecorder {
  private history: RecorderFrame[] = []
  private pending: PendingCapture | null = null
  private seq = 0
  private lastOwnershipGapCount = 0
  private lastViolationCount = 0
  private lastWriteAt = 0

  constructor(
    private readonly writeRecording: TransitionRecordingWriter = (payload) =>
      window.api.debug.writeTransitionRecording(payload),
  ) {}

  observe(
    frame: number,
    avatar: AvatarRuntimeDebugState,
    runtimeHealth: RuntimeHealth | null,
  ): void {
    const snapshot = createRecorderFrame(frame, avatar, runtimeHealth)
    this.history = [...this.history, snapshot].slice(-HISTORY_FRAME_COUNT)

    const reason = this.detectReason(avatar, runtimeHealth)
    const captureStarted = reason ? this.trigger(reason, snapshot) : false

    if (!this.pending || captureStarted) return
    this.pending.frames.push(snapshot)
    this.pending.remainingFutureFrames -= 1
    if (this.pending.remainingFutureFrames <= 0) void this.flush()
  }

  private detectReason(
    avatar: AvatarRuntimeDebugState,
    runtimeHealth: RuntimeHealth | null,
  ): string | null {
    const body = avatar.bodyActions
    const hipsJump = Math.abs(body.hipsDeltaY) > 0.1
    if (hipsJump)
      return `hips jump ${body.hipsDeltaY.toFixed(3)} during ${body.lastLoadAnimationId ?? 'none'}`

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

  private trigger(reason: string, snapshot: RecorderFrame): boolean {
    const now = Date.now()
    if (this.pending || now - this.lastWriteAt < 1500) return false
    const boundedReason = truncate(reason) ?? 'transition'
    this.pending = {
      id: ++this.seq,
      reason: boundedReason,
      startedAtFrame: snapshot.frame,
      remainingFutureFrames: FUTURE_FRAME_COUNT,
      frames: this.history.map((frame, index) =>
        index === this.history.length - 1 ? { ...frame, reason: boundedReason } : frame,
      ),
    }
    return true
  }

  private async flush(): Promise<void> {
    const capture = this.pending
    if (!capture) return
    this.pending = null
    this.lastWriteAt = Date.now()
    const payload = fitRecordingToBudget({
      schema: 'shio.transition-recording.v1',
      id: capture.id,
      reason: capture.reason,
      startedAtFrame: capture.startedAtFrame,
      savedAt: new Date().toISOString(),
      frames: capture.frames,
    })
    try {
      const result = await this.writeRecording(payload)
      if (result.ok) {
        console.log(
          `[TRANSITIONREC] saved reason="${capture.reason}" file=${result.filePath ?? 'unknown'}`,
        )
      }
    } catch (error) {
      console.warn('[TRANSITIONREC] failed to save transition recording', error)
    }
  }
}
