import assert from 'node:assert/strict'

import sharp from 'sharp'

import {
  type ExtractedGameEvent,
  type GameEventExtractionContext,
  GameEventExtractionLane,
  type GameEventExtractor,
} from '../../src/main/browser-game/GameEventExtractor'
import type {
  GameReflexAdapter,
  GameReflexBackendStatus,
} from '../../src/main/browser-game/GameReflexAdapter'
import type {
  GameCalibrationContext,
  GameReflexState,
} from '../../src/main/browser-game/GameReflexPolicy'
import { AdapterBackedGameReflexPolicy } from '../../src/main/browser-game/GameReflexPolicy'
import { GameSessionController } from '../../src/main/browser-game/GameSessionController'
import {
  BrowserGameError,
  type GameFrame,
  type GameInputIntent,
  type GameSemanticEvent,
} from '../../src/shared/browser-game'
import type {
  BrowserGameBlockerKind,
  BrowserGameEnvironmentInspection,
  BrowserGameSurfaceCandidate,
  BrowserRealtimeControlProvider,
  BrowserRealtimeFrame,
  BrowserRealtimeInputBatch,
  BrowserRealtimeSession,
} from '../../src/shared/desktop-control'

class TestReflexAdapter implements GameReflexAdapter {
  initialized: GameCalibrationContext | null = null
  readonly frames: GameFrame[] = []
  intents: GameInputIntent[] = []
  resetCount = 0
  onDecide: (() => void) | null = null

  status(): GameReflexBackendStatus {
    return { backendId: 'fixture-reflex', mode: 'local-visual', ready: true }
  }

  async initialize(context: GameCalibrationContext): Promise<void> {
    this.initialized = context
  }

  async decide(frame: GameFrame, _state: GameReflexState): Promise<GameInputIntent> {
    this.frames.push(frame)
    this.onDecide?.()
    return this.intents.shift() ?? { type: 'none' }
  }

  reset(): void {
    this.resetCount += 1
  }
}

class TestEventExtractor implements GameEventExtractor {
  readonly frames: GameFrame[] = []
  events: ExtractedGameEvent[] = []
  resetCount = 0

  async extract(
    frame: GameFrame,
    _state: GameEventExtractionContext,
  ): Promise<readonly ExtractedGameEvent[]> {
    this.frames.push(frame)
    return this.events.splice(0, this.events.length)
  }

  reset(): void {
    this.resetCount += 1
  }
}

class SlowEventExtractor implements GameEventExtractor {
  readonly frameIds: number[] = []
  private releaseFirstExtraction: (() => void) | null = null

  async extract(frame: GameFrame): Promise<readonly ExtractedGameEvent[]> {
    this.frameIds.push(frame.frameId)
    if (this.frameIds.length === 1) {
      await new Promise<void>((resolve) => {
        this.releaseFirstExtraction = resolve
      })
    }
    return [{ type: 'score-changed', value: frame.frameId }]
  }

  release(): void {
    this.releaseFirstExtraction?.()
  }

  reset(): void {}
}

interface FrameWaiter {
  resolve(frame: BrowserRealtimeFrame): void
  reject(error: unknown): void
}

class TestRealtime implements BrowserRealtimeControlProvider {
  binding: BrowserRealtimeSession | null = {
    sessionId: 'browser-session-11111111-1111-4111-8111-111111111111',
    tabId: 'tab-game',
    origin: 'https://game.example',
    url: 'https://game.example/play',
    connectedAt: 1_000,
  }
  readonly surface: BrowserGameSurfaceCandidate = {
    id: 'game-surface-0',
    kind: 'canvas',
    label: 'Fixture game',
    bounds: { x: 100, y: 50, width: 400, height: 300 },
  }
  readonly inputs: BrowserRealtimeInputBatch[] = []
  releaseCount = 0
  blocker: BrowserGameBlockerKind | undefined
  environmentError: Error | undefined
  deferNextEnvironmentInspection = false
  private environmentResolver: ((inspection: BrowserGameEnvironmentInspection) => void) | null =
    null
  private waiter: FrameWaiter | null = null

  session(): BrowserRealtimeSession | null {
    return this.binding ? { ...this.binding } : null
  }

  async inspectGameEnvironment() {
    if (this.environmentError) throw this.environmentError
    if (this.deferNextEnvironmentInspection) {
      this.deferNextEnvironmentInspection = false
      return new Promise<BrowserGameEnvironmentInspection>((resolve) => {
        this.environmentResolver = resolve
      })
    }
    return { surfaces: [this.surface], ...(this.blocker ? { blocker: this.blocker } : {}) }
  }

  environmentInspectionPending(): boolean {
    return this.environmentResolver !== null
  }

  resolveEnvironmentInspection(blocker?: BrowserGameBlockerKind): void {
    assert(this.environmentResolver, 'environment inspection must be pending')
    const resolve = this.environmentResolver
    this.environmentResolver = null
    resolve({ surfaces: [this.surface], ...(blocker ? { blocker } : {}) })
  }

  captureFrame(_request: unknown, signal: AbortSignal): Promise<BrowserRealtimeFrame> {
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        this.waiter = null
        reject(new Error('capture aborted'))
      }
      signal.addEventListener('abort', abort, { once: true })
      this.waiter = {
        resolve: (frame) => {
          signal.removeEventListener('abort', abort)
          this.waiter = null
          resolve(frame)
        },
        reject,
      }
    })
  }

  async dispatchInput(input: BrowserRealtimeInputBatch): Promise<void> {
    this.inputs.push(input)
  }

  async releaseInputs(): Promise<void> {
    this.releaseCount += 1
  }

  async getViewport() {
    return { width: 1_280, height: 720, pageScaleFactor: 1 }
  }

  emit(frame: BrowserRealtimeFrame): void {
    assert(this.waiter, 'frame capture must be pending')
    this.waiter.resolve(frame)
  }

  capturePending(): boolean {
    return this.waiter !== null
  }
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('condition did not become true')
}

async function main(): Promise<void> {
  let now = 10_000
  const realtime = new TestRealtime()
  const reflexAdapter = new TestReflexAdapter()
  const eventExtractor = new TestEventExtractor()
  const gameEvents: GameSemanticEvent[] = []
  reflexAdapter.intents.push({ type: 'pointer-tap', x: 100, y: 75 })
  eventExtractor.events.push({ type: 'checkpoint', importance: 'normal', value: 1 })
  const controller = new GameSessionController({
    realtime: () => realtime,
    reflex: new AdapterBackedGameReflexPolicy(reflexAdapter),
    eventExtractor,
    onEvent: (event) => gameEvents.push(event),
    now: () => now,
    createId: (() => {
      let id = 0
      return () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`
    })(),
  })

  const surfaces = await controller.discoverSurfaces(new AbortController().signal)
  assert.deepEqual(surfaces, [realtime.surface])
  const prepared = await controller.prepareStart(
    { goal: 'Play the fixture' },
    new AbortController().signal,
  )
  assert.equal(prepared.browserSessionId, realtime.binding?.sessionId)
  assert.equal(prepared.surface.id, realtime.surface.id)
  const running = await controller.start(
    prepared.preparationId,
    'action-10000-11111111-1111-4111-8111-111111111111',
    new AbortController().signal,
  )
  assert.equal(running.state, 'running')
  assert.equal(running.scope?.origin, 'https://game.example')
  assert.equal(reflexAdapter.initialized?.scope.authorizationActionId.startsWith('action-'), true)
  assert.equal(gameEvents[0]?.type, 'game-started')

  await waitUntil(() => realtime.capturePending())
  const bytes = await sharp({
    create: { width: 640, height: 360, channels: 3, background: '#204060' },
  })
    .jpeg()
    .toBuffer()
  realtime.emit({
    sessionId: realtime.binding?.sessionId ?? '',
    tabId: realtime.binding?.tabId ?? '',
    frameId: 1,
    capturedAt: now,
    width: 640,
    height: 360,
    viewport: { width: 1_280, height: 720, pageScaleFactor: 1 },
    image: { mimeType: 'image/jpeg', bytes },
  })
  await waitUntil(() => realtime.inputs.length === 1)
  await waitUntil(() => gameEvents.some((event) => event.type === 'checkpoint'))
  assert.equal(reflexAdapter.frames[0]?.width, 200)
  assert.equal(reflexAdapter.frames[0]?.height, 150)
  assert.deepEqual(realtime.inputs[0]?.events, [
    { type: 'pointer-down', x: 300, y: 200, button: 'left' },
    { type: 'pointer-up', x: 300, y: 200, button: 'left' },
  ])

  await waitUntil(() => realtime.capturePending())
  const paused = await controller.pause()
  assert.equal(paused.state, 'paused')
  assert(gameEvents.some((event) => event.type === 'game-paused'))
  assert(realtime.releaseCount >= 1)
  assert.equal(realtime.inputs.length, 1)

  const resumed = await controller.resume()
  assert.equal(resumed.state, 'running')
  await waitUntil(() => realtime.capturePending())
  now += 2_001
  realtime.blocker = 'authentication'
  realtime.emit({
    sessionId: realtime.binding?.sessionId ?? '',
    tabId: realtime.binding?.tabId ?? '',
    frameId: 2,
    capturedAt: now,
    width: 640,
    height: 360,
    viewport: { width: 1_280, height: 720, pageScaleFactor: 1 },
    image: { mimeType: 'image/jpeg', bytes },
  })
  await waitUntil(() => controller.status().state === 'waiting-user')
  assert.equal(controller.status().waitingReason, 'authentication')
  assert(gameEvents.some((event) => event.type === 'waiting-user'))
  realtime.blocker = undefined
  const resumedAfterIntervention = await controller.resume()
  assert.equal(resumedAfterIntervention.state, 'running')
  assert.equal(resumedAfterIntervention.waitingReason, undefined)
  await waitUntil(() => realtime.capturePending())
  realtime.binding = realtime.binding ? { ...realtime.binding, tabId: 'tab-other' } : null
  await controller.pause()
  await assert.rejects(
    () => controller.resume(),
    (error) => error instanceof BrowserGameError && error.code === 'GAME_SCOPE_CHANGED',
  )
  assert.equal(controller.status().state, 'error')
  assert(gameEvents.some((event) => event.type === 'game-error'))
  assert(gameEvents.some((event) => event.type === 'game-stopped'))
  assert(realtime.releaseCount >= 2)

  now += 100
  await controller.stop()
  assert.equal(controller.status().scope, undefined)
  assert(reflexAdapter.resetCount >= 1)
  assert(eventExtractor.resetCount >= 1)

  let staleNow = 20_000
  const staleRealtime = new TestRealtime()
  const staleReflex = new TestReflexAdapter()
  staleReflex.intents.push({ type: 'pointer-tap', x: 20, y: 20 })
  staleReflex.onDecide = () => {
    staleNow += 501
  }
  const staleController = new GameSessionController({
    realtime: () => staleRealtime,
    reflex: new AdapterBackedGameReflexPolicy(staleReflex),
    now: () => staleNow,
  })
  const stalePreparation = await staleController.prepareStart(
    { goal: 'Discard stale fixture decisions' },
    new AbortController().signal,
  )
  await staleController.start(
    stalePreparation.preparationId,
    'action-20000-22222222-2222-4222-8222-222222222222',
    new AbortController().signal,
  )
  await waitUntil(() => staleRealtime.capturePending())
  staleRealtime.emit({
    sessionId: staleRealtime.binding?.sessionId ?? '',
    tabId: staleRealtime.binding?.tabId ?? '',
    frameId: 2,
    capturedAt: staleNow,
    width: 640,
    height: 360,
    viewport: { width: 1_280, height: 720, pageScaleFactor: 1 },
    image: { mimeType: 'image/jpeg', bytes },
  })
  await waitUntil(() => staleController.status().telemetry.staleDecisions === 1)
  assert.equal(staleRealtime.inputs.length, 0)
  await staleController.pause()
  assert(staleRealtime.releaseCount >= 1)

  const blockedRealtime = new TestRealtime()
  blockedRealtime.blocker = 'captcha'
  const blockedReflex = new TestReflexAdapter()
  const blockedController = new GameSessionController({
    realtime: () => blockedRealtime,
    reflex: new AdapterBackedGameReflexPolicy(blockedReflex),
  })
  const blockedPreparation = await blockedController.prepareStart(
    { goal: 'Wait for manual CAPTCHA completion' },
    new AbortController().signal,
  )
  const blockedStart = await blockedController.start(
    blockedPreparation.preparationId,
    'action-30000-33333333-3333-4333-8333-333333333333',
    new AbortController().signal,
  )
  assert.equal(blockedStart.state, 'waiting-user')
  assert.equal(blockedStart.waitingReason, 'captcha')
  assert.equal(blockedReflex.initialized, null)
  assert(blockedRealtime.releaseCount >= 1)
  blockedRealtime.blocker = undefined
  assert.equal((await blockedController.resume()).state, 'running')
  assert(blockedReflex.initialized)
  await waitUntil(() => blockedRealtime.capturePending())
  await blockedController.stop()

  let failedInspectionNow = 30_000
  const failedInspectionRealtime = new TestRealtime()
  const failedInspectionController = new GameSessionController({
    realtime: () => failedInspectionRealtime,
    reflex: new AdapterBackedGameReflexPolicy(new TestReflexAdapter()),
    now: () => failedInspectionNow,
  })
  const failedInspectionPreparation = await failedInspectionController.prepareStart(
    { goal: 'Stop safely when environment trust is lost' },
    new AbortController().signal,
  )
  await failedInspectionController.start(
    failedInspectionPreparation.preparationId,
    'action-40000-44444444-4444-4444-8444-444444444444',
    new AbortController().signal,
  )
  await waitUntil(() => failedInspectionRealtime.capturePending())
  failedInspectionNow += 2_001
  failedInspectionRealtime.environmentError = new Error('inspection unavailable')
  failedInspectionRealtime.emit({
    sessionId: failedInspectionRealtime.binding?.sessionId ?? '',
    tabId: failedInspectionRealtime.binding?.tabId ?? '',
    frameId: 4,
    capturedAt: failedInspectionNow,
    width: 640,
    height: 360,
    viewport: { width: 1_280, height: 720, pageScaleFactor: 1 },
    image: { mimeType: 'image/jpeg', bytes },
  })
  await waitUntil(() => failedInspectionController.status().state === 'error')
  assert(failedInspectionRealtime.releaseCount >= 1)

  let inspectionRaceNow = 40_000
  const inspectionRaceRealtime = new TestRealtime()
  const inspectionRaceController = new GameSessionController({
    realtime: () => inspectionRaceRealtime,
    reflex: new AdapterBackedGameReflexPolicy(new TestReflexAdapter()),
    now: () => inspectionRaceNow,
  })
  const inspectionRacePreparation = await inspectionRaceController.prepareStart(
    { goal: 'Ignore obsolete environment inspection generations' },
    new AbortController().signal,
  )
  await inspectionRaceController.start(
    inspectionRacePreparation.preparationId,
    'action-50000-55555555-5555-4555-8555-555555555555',
    new AbortController().signal,
  )
  await waitUntil(() => inspectionRaceRealtime.capturePending())
  inspectionRaceNow += 2_001
  inspectionRaceRealtime.deferNextEnvironmentInspection = true
  inspectionRaceRealtime.emit({
    sessionId: inspectionRaceRealtime.binding?.sessionId ?? '',
    tabId: inspectionRaceRealtime.binding?.tabId ?? '',
    frameId: 5,
    capturedAt: inspectionRaceNow,
    width: 640,
    height: 360,
    viewport: { width: 1_280, height: 720, pageScaleFactor: 1 },
    image: { mimeType: 'image/jpeg', bytes },
  })
  await waitUntil(() => inspectionRaceRealtime.environmentInspectionPending())
  await inspectionRaceController.pause()
  assert.equal((await inspectionRaceController.resume()).state, 'running')
  inspectionRaceRealtime.resolveEnvironmentInspection('authentication')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(inspectionRaceController.status().state, 'running')
  await inspectionRaceController.stop()

  const slowExtractor = new SlowEventExtractor()
  const extractedValues: number[] = []
  const extractionErrors: unknown[] = []
  const lane = new GameEventExtractionLane(
    slowExtractor,
    (events) => {
      for (const event of events) {
        if (event.value !== undefined) extractedValues.push(event.value)
      }
    },
    (error) => extractionErrors.push(error),
  )
  const extractionSignal = new AbortController().signal
  const extractionState = { strategy: 'balanced' as const, elapsedMs: 1, inputEvents: 0 }
  const extractionFrame = (frameId: number): GameFrame => ({
    sessionId: 'game-session-33333333-3333-4333-8333-333333333333',
    frameId,
    capturedAt: staleNow,
    width: 100,
    height: 100,
    image: { mimeType: 'image/jpeg', bytes },
  })
  lane.offer(extractionFrame(10), extractionState, extractionSignal)
  await waitUntil(() => slowExtractor.frameIds.length === 1)
  lane.offer(extractionFrame(11), extractionState, extractionSignal)
  lane.offer(extractionFrame(12), extractionState, extractionSignal)
  slowExtractor.release()
  await waitUntil(() => extractedValues.length === 2)
  assert.deepEqual(slowExtractor.frameIds, [10, 12])
  assert.deepEqual(extractedValues, [10, 12])
  assert.deepEqual(extractionErrors, [])
  console.log('browser game controller repro passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
