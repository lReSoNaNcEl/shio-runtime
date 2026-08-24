import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { transitionRecordingSchema } from '../../src/main/ipc/payloadSchemas'
import { RendererProcessHealthTracker } from '../../src/main/windows/RendererProcessHealthTracker'
import { observeRendererPromise } from '../../src/renderer/reliability/observePromise'
import type { AvatarRuntimeDebugState } from '../../src/renderer/runtime/AvatarRuntime'
import { AvatarRuntimeHealthTracker } from '../../src/renderer/runtime/AvatarRuntimeHealthTracker'
import { OverlayRuntime } from '../../src/renderer/runtime/OverlayRuntime'
import { TransitionRecorder } from '../../src/renderer/runtime/TransitionRecorder'
import { parseCharacterEmbodimentResponse } from '../../src/shared/character-response'

const desktopRoot = process.cwd().endsWith('apps\\desktop')
  ? process.cwd()
  : join(process.cwd(), 'apps', 'desktop')

function source(relativePath: string): string {
  return readFileSync(join(desktopRoot, relativePath), 'utf8')
}

function assertAvatarHealthContract(): void {
  let tick = 0
  const snapshots: string[] = []
  const tracker = new AvatarRuntimeHealthTracker(
    (health) => snapshots.push(health.status),
    () => new Date(Date.UTC(2026, 7, 22, 0, 0, tick++)),
  )
  tracker.reportCurrent()
  tracker.setPresentationAttached(true)
  tracker.markLoading()
  tracker.markReady(true)
  assert.deepEqual(snapshots, ['not-initialized', 'not-initialized', 'loading', 'ready'])
  assert.equal(tracker.getSnapshot().operational, true)
  tracker.setPresentationAttached(false)
  assert.equal(tracker.getSnapshot().operational, false)
  tracker.markFailed(new Error('model failed'), false)
  assert.equal(tracker.getSnapshot().lastFailure?.message, 'model failed')
  tracker.markDisposed()
  tracker.markReady(true)
  assert.equal(
    tracker.getSnapshot().status,
    'disposed',
    'late load must not revive disposed health',
  )
}

function assertRendererProcessHealth(): void {
  const tracker = new RendererProcessHealthTracker(() => new Date('2026-08-22T00:00:00.000Z'))
  tracker.markLoading()
  tracker.markLoadFailure(-105, 'name not resolved')
  assert.equal(tracker.claimRecovery(), true)
  assert.equal(tracker.claimRecovery(), false, 'renderer recovery must be bounded')
  tracker.markReady()
  assert.equal(tracker.getSnapshot().status, 'ready')
  assert.equal(tracker.getSnapshot().lastFailure?.kind, 'load')
  tracker.markProcessGone('crashed', 7)
  assert.equal(tracker.getSnapshot().status, 'render-process-gone')
}

function assertMalformedMarkerContainment(): void {
  assert.equal(
    parseCharacterEmbodimentResponse('[warm]Visible reply.<shio-embodiment>{"intensity":"normal"')
      .replyText,
    '[warm]Visible reply.',
  )
  assert.equal(
    parseCharacterEmbodimentResponse('[warm]Visible reply.</shio-embodiment>').replyText,
    '[warm]Visible reply.',
  )
}

function assertStaticLifecycleWiring(): void {
  const mainWindow = source('src/main/windows/MainWindowManager.ts')
  assert.match(
    mainWindow,
    /backgroundThrottling:\s*false/,
    'main renderer must keep the Avatar Runtime and LipSync tick alive while minimized',
  )
  const controller = source('src/renderer/Controller.ts')
  const avatarTickStart = controller.indexOf('private startAvatarTickLoop')
  const avatarTickEnd = controller.indexOf('applyOverlaySettings', avatarTickStart)
  assert(avatarTickStart >= 0 && avatarTickEnd > avatarTickStart)
  const avatarTick = controller.slice(avatarTickStart, avatarTickEnd)
  assert.match(avatarTick, /window\.setInterval\(tick, AVATAR_RUNTIME_TICK_MS\)/)
  assert.doesNotMatch(
    avatarTick,
    /requestAnimationFrame/,
    'application-owned Avatar/LipSync updates must not depend on minimized-window paint cadence',
  )

  for (const windowManager of [
    'src/main/windows/MainWindowManager.ts',
    'src/main/windows/OverlayWindowManager.ts',
  ]) {
    const contents = source(windowManager)
    assert.match(contents, /'did-fail-load'/)
    assert.match(contents, /'render-process-gone'/)
    assert.match(contents, /claimRecovery\(\)/)
  }

  const releaseSupport = source('src/main/system/releaseSupport.ts')
  assert.doesNotMatch(releaseSupport, /\bvrmLoaded\s*:/)
  assert.match(releaseSupport, /reportFresh:/)
  assert.match(releaseSupport, /mainRenderer\.status === 'ready'/)

  const root = source('src/renderer/main.tsx')
  assert.match(root, /<RendererErrorBoundary>/)
  const overlay = source('src/renderer/runtime/OverlayRuntime.ts')
  assert.match(overlay, /remoteUnsubscribers/)
  assert.match(overlay, /disposeRemoteSubscriptions\(\)/)
  const app = source('src/renderer/components/App.tsx')
  assert.match(app, /return window\.api\.config\.onUpdated/)
  assert.match(app, /return \(\) => controller\.dispose\(\)/)

  const chat = source('src/renderer/components/chat/ChatOverlay.tsx')
  const submission = chat.slice(chat.indexOf('const submit ='))
  const clearDraftAt = submission.indexOf("controller.setChatDraft('')")
  const awaitTurnAt = submission.indexOf('await controller.sendText')
  assert(clearDraftAt >= 0, 'accepted text submission must clear the composer draft')
  assert(
    clearDraftAt < awaitTurnAt,
    'composer draft must clear before waiting for LLM, TTS, and playback completion',
  )
}

function transitionRecording(framePayload: string, frameCount = 1): unknown {
  return {
    schema: 'shio.transition-recording.v1',
    id: 1,
    reason: 'focused repro',
    startedAtFrame: 1,
    savedAt: '2026-08-22T00:00:00.000Z',
    frames: Array.from({ length: frameCount }, (_, index) => ({
      at: index,
      frame: index,
      avatar: { payload: framePayload },
      runtimeHealth: null,
    })),
  }
}

function assertTransitionRecordingContract(): void {
  assert.equal(
    transitionRecordingSchema.safeParse(transitionRecording('x'.repeat(250_000), 8)).success,
    true,
    'legitimate multi-frame recordings must fit the dedicated diagnostic contract',
  )
  assert.equal(
    transitionRecordingSchema.safeParse(transitionRecording('x'.repeat(600_000), 9)).success,
    false,
    'recordings above the five-megabyte boundary must be rejected',
  )
  assert.equal(
    transitionRecordingSchema.safeParse(transitionRecording('x', 122)).success,
    false,
    'recordings must not exceed the bounded frame count',
  )
}

function realisticAvatarDebugState(frame: number, hipsDeltaY: number): AvatarRuntimeDebugState {
  const actions = Array.from({ length: 8 }, (_, index) => ({
    name: `action-${index}`,
    actionInstanceId: index,
    clipInstanceId: index,
    weight: 0.5,
    time: frame / 60,
    duration: 4,
    enabled: true,
    running: true,
    fadingOut: false,
    current: index === 0,
    previous: index === 1,
  }))
  const frameTrace = Array.from({ length: 140 }, (_, index) => ({
    at: frame * 16 + index,
    frame: frame - 140 + index,
    label: 'transition-frame',
    animationId: 'idle_soft',
    previousAnimationId: 'idle_neutral',
    mixerActionCount: actions.length,
    bodyActionCount: actions.length,
    weightedActionCount: actions.length,
    totalEffectiveWeight: 1,
    hasWeightGap: false,
    hasZeroWeightedActions: false,
    currentActionInfluential: true,
    currentWeight: 0.8,
    previousWeight: 0.2,
    transitionRemaining: 0.2,
    cleanupState: 'active',
    localRootQuaternion: '0.000,0.000,0.000,1.000',
    hipsQuaternion: '0.000,0.000,0.000,1.000',
    firstBoneChangeAfterPlayFrame: frame,
    framesSincePlayWithoutBoneChange: null,
    hipsDeltaY,
    rootDeltaY: 0,
    mixerActions: actions,
    actions,
  }))
  const requests = Array.from({ length: 40 }, (_, index) => ({
    id: index,
    frame: frame - 40 + index,
    animationId: 'idle_soft',
    behaviorId: 'ambient-idle',
    source: 'idle-orchestrator' as const,
    reason: 'scheduled ambient idle behavior',
    accepted: true,
    decision: 'play' as const,
    rejectionReason: null,
    currentAnimationId: 'idle_neutral',
    requestedAnimationId: 'idle_soft',
    transitionPolicy: 'soft-crossfade',
    transitionPending: true,
  }))
  const behaviorTimeline = Array.from({ length: 40 }, (_, index) => ({
    at: frame * 16 + index,
    frame: frame - 40 + index,
    fromBehaviorId: 'ambient-idle',
    toBehaviorId: 'ambient-idle',
    fromAnimationId: 'idle_neutral',
    toAnimationId: 'idle_soft',
    mode: 'idle' as const,
    source: 'idle-orchestrator' as const,
    reason: 'scheduled ambient idle behavior',
    accepted: true,
  }))

  return {
    mode: 'idle',
    emotionKey: 'neutral',
    currentBodyAnimation: 'idle_soft',
    currentBodyAnimationFile: 'idle_soft.vrma',
    currentBodyAnimationLoop: true,
    currentBodyAnimationStatus: 'playing',
    bodyActions: {
      activeActionCount: actions.length,
      weightedActionCount: actions.length,
      currentClipName: 'idle_soft',
      currentClipDuration: 4,
      currentClipTime: frame / 60,
      transitionRemaining: 0.2,
      rootMotionPolicy: 'in-place',
      hipsDeltaY,
      rootDeltaY: 0,
      maxHipsDeltaY: Math.abs(hipsDeltaY),
      maxRootDeltaY: 0,
      lastLoadSource: 'idle-orchestrator',
      lastLoadReason: 'scheduled ambient idle behavior',
      lastLoadAnimationId: 'idle_soft',
      lastLoadFile: 'idle_soft.vrma',
      restartCount: 0,
      ownershipGapCount: 0,
      lastTransitionEvent: 'crossfade',
      clipCache: { loads: 1, reuses: 1, hits: 1, misses: 0, parses: 1 },
      facialControlTracksDisabled: 0,
      facialControlTrackNames: [],
      frameTrace,
      actions,
    },
    animationAssetCache: { fetches: 1, hits: 1, misses: 0 },
    previousBodyAnimation: 'idle_neutral',
    activeTransitionPolicy: 'soft-crossfade',
    activeBlendDuration: 0.3,
    playbackRequests: {
      currentAnimation: 'idle_soft',
      requestedAnimation: 'idle_soft',
      currentTransition: 'soft-crossfade',
      transitionPending: true,
      replayCount: 0,
      ignoredDuplicateRequests: 0,
      requests,
    },
    behaviorTimeline,
  } as unknown as AvatarRuntimeDebugState
}

function assertTransitionRecorderBounds(): void {
  let recorded: unknown = null
  const recorder = new TransitionRecorder(async (payload) => {
    recorded = payload
    return { ok: false }
  })

  for (let frame = 0; frame < 120; frame += 1) {
    recorder.observe(frame, realisticAvatarDebugState(frame, frame === 59 ? 0.2 : 0), null)
  }

  const parsed = transitionRecordingSchema.parse(recorded)
  assert.equal(parsed.frames.length, 120, 'capture must contain 60 history and 60 future frames')
  assert.equal(
    parsed.frames.filter((frame) => frame.reason).length,
    1,
    'the trigger frame must be recorded exactly once',
  )
  for (const frame of parsed.frames) {
    const bodyActions = frame.avatar.bodyActions as { frameTrace?: unknown[] } | undefined
    const playbackRequests = frame.avatar.playbackRequests as { requests?: unknown[] } | undefined
    const behaviorTimeline = frame.avatar.behaviorTimeline as unknown[] | undefined
    assert((bodyActions?.frameTrace?.length ?? 0) <= 1)
    assert((playbackRequests?.requests?.length ?? 0) <= 1)
    assert((behaviorTimeline?.length ?? 0) <= 1)
  }
}

function assertOverlaySubscriptionCleanup(): void {
  let cleanupCount = 0
  const subscription = () => () => {
    cleanupCount += 1
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { search: '?overlay=1' },
      overlayApi: {
        avatarState: { onUpdated: subscription },
        avatarMouth: { onUpdated: subscription },
        config: { onUpdated: subscription },
      },
    },
  })
  const runtime = new OverlayRuntime()
  runtime.subscribeToRemoteUpdates({})
  runtime.subscribeToRemoteUpdates({})
  assert.equal(cleanupCount, 3, 'resubscribe must release the previous listener set')
  runtime.dispose()
  assert.equal(cleanupCount, 6, 'dispose must release every active Overlay listener')
  Reflect.deleteProperty(globalThis, 'window')
}

async function assertDetachedPromiseObserver(): Promise<void> {
  const previousError = console.error
  let observed: unknown = null
  console.error = () => {}
  try {
    await new Promise<void>((resolve) => {
      observeRendererPromise(Promise.reject(new Error('detached failure')), 'repro', (error) => {
        observed = error
        resolve()
      })
    })
  } finally {
    console.error = previousError
  }
  assert(observed instanceof Error)
}

async function main(): Promise<void> {
  assertAvatarHealthContract()
  assertRendererProcessHealth()
  assertMalformedMarkerContainment()
  assertStaticLifecycleWiring()
  assertTransitionRecordingContract()
  assertTransitionRecorderBounds()
  assertOverlaySubscriptionCleanup()
  await assertDetachedPromiseObserver()
  console.log('Desktop Reliability & Contract Cleanup focused repro: PASS')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
