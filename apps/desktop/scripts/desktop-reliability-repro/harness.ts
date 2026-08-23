import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { transitionRecordingSchema } from '../../src/main/ipc/payloadSchemas'
import { RendererProcessHealthTracker } from '../../src/main/windows/RendererProcessHealthTracker'
import { observeRendererPromise } from '../../src/renderer/reliability/observePromise'
import { AvatarRuntimeHealthTracker } from '../../src/renderer/runtime/AvatarRuntimeHealthTracker'
import { OverlayRuntime } from '../../src/renderer/runtime/OverlayRuntime'
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
  assertOverlaySubscriptionCleanup()
  await assertDetachedPromiseObserver()
  console.log('Desktop Reliability & Contract Cleanup focused repro: PASS')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
