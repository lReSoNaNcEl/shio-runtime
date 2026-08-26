import assert from 'node:assert/strict'

import sharp from 'sharp'

import { BrowserGamePlugin } from '../../src/main/browser-game/BrowserGamePlugin'
import {
  type ExtractedGameEvent,
  type GameEventExtractionContext,
  GameEventExtractionLane,
  type GameEventExtractor,
} from '../../src/main/browser-game/GameEventExtractor'
import type { GameReflexAdapter } from '../../src/main/browser-game/GameReflexAdapter'
import type {
  GameCalibrationContext,
  GameReflexState,
} from '../../src/main/browser-game/GameReflexPolicy'
import { AdapterBackedGameReflexPolicy } from '../../src/main/browser-game/GameReflexPolicy'
import type {
  GameSemanticPerceptionAdapter,
  GameSemanticPerceptionSnapshot,
} from '../../src/main/browser-game/GameSemanticPerceptionAdapter'
import { GameSessionController } from '../../src/main/browser-game/GameSessionController'
import { HybridGameEventExtractor } from '../../src/main/browser-game/HybridGameEventExtractor'
import { LlmGameSemanticPerceptionAdapter } from '../../src/main/browser-game/LlmGameSemanticPerceptionAdapter'
import { LocalVisualGameEventExtractor } from '../../src/main/browser-game/LocalVisualGameEventExtractor'
import { LocalVisualTargetReflexAdapter } from '../../src/main/browser-game/LocalVisualTargetReflexAdapter'
import type { ChatMessage, LLMProvider, LlmRequestOptions } from '../../src/main/llm'
import {
  BrowserGameError,
  type GameFrame,
  type GameInputIntent,
  type GameReflexBackendStatus,
  type GameSemanticEvent,
  type GameSessionScope,
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
  suspendCount = 0
  resetCount = 0
  onDecide: (() => void) | null = null

  status(): GameReflexBackendStatus {
    return {
      backendId: 'fixture-reflex',
      mode: 'local-visual',
      ready: true,
      supportedInputs: ['pointer', 'keyboard'],
      semanticPerception: true,
    }
  }

  async initialize(context: GameCalibrationContext): Promise<void> {
    this.initialized = context
  }

  async decide(frame: GameFrame, _state: GameReflexState): Promise<GameInputIntent> {
    this.frames.push(frame)
    this.onDecide?.()
    return this.intents.shift() ?? { type: 'none' }
  }

  suspend(): void {
    this.suspendCount += 1
  }

  reset(): void {
    this.resetCount += 1
  }
}

class TestEventExtractor implements GameEventExtractor {
  readonly frames: GameFrame[] = []
  events: ExtractedGameEvent[] = []
  resetCount = 0

  status() {
    return {
      backendId: 'fixture-events',
      mode: 'low-frequency-semantic' as const,
      ready: true,
      sampleRateHz: 1,
      semanticPerception: true,
    }
  }

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

  status() {
    return {
      backendId: 'slow-fixture-events',
      mode: 'low-frequency-semantic' as const,
      ready: true,
      sampleRateHz: 1,
      semanticPerception: true,
    }
  }

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

class TestSemanticPerceptionAdapter implements GameSemanticPerceptionAdapter {
  ready = true
  readonly snapshots: GameSemanticPerceptionSnapshot[] = []
  readonly calls: Array<{ previous: GameSemanticPerceptionSnapshot | null; signal: AbortSignal }> =
    []
  deferNext = false
  resetCount = 0

  status() {
    return { backendId: 'fixture-semantic', ready: this.ready, sampleRateHz: 0.2 }
  }

  async analyze(
    _frame: GameFrame,
    _state: GameEventExtractionContext,
    previous: GameSemanticPerceptionSnapshot | null,
    signal: AbortSignal,
  ): Promise<GameSemanticPerceptionSnapshot | null> {
    this.calls.push({ previous, signal })
    if (this.deferNext) {
      this.deferNext = false
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    return this.snapshots.shift() ?? null
  }

  reset(): void {
    this.resetCount += 1
  }
}

class TestVisionProvider implements LLMProvider {
  supportsVision = true
  response = ''
  calls: Array<{ messages: readonly ChatMessage[]; options?: LlmRequestOptions }> = []

  capabilities() {
    return {
      supportsReasoning: false,
      supportsStreaming: false,
      supportsTemperature: false,
      supportsSystemPrompt: true,
      supportsToolCalling: false,
      supportsVision: this.supportsVision,
      recommendedMaxTokens: 1_024,
    }
  }

  async chat(messages: readonly ChatMessage[], options?: LlmRequestOptions): Promise<string> {
    this.calls.push({ messages, options })
    return this.response
  }
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

async function visualTargetFrame(options: {
  frameId: number
  capturedAt: number
  targetX?: number
}): Promise<GameFrame> {
  const image = sharp({
    create: { width: 320, height: 180, channels: 3, background: '#101827' },
  })
  const overlays: sharp.OverlayOptions[] = [
    {
      input: Buffer.from(
        '<svg width="120" height="6"><rect width="120" height="6" fill="#38bdf8"/></svg>',
      ),
      left: 0,
      top: 174,
    },
  ]
  if (options.targetX !== undefined) {
    overlays.push({
      input: Buffer.from(
        '<svg width="48" height="48"><circle cx="24" cy="24" r="24" fill="#ff2fa8"/></svg>',
      ),
      left: options.targetX - 24,
      top: 66,
    })
  }
  const bytes = await image.composite(overlays).png().toBuffer()
  return {
    sessionId: 'game-session-77777777-7777-4777-8777-777777777777',
    frameId: options.frameId,
    capturedAt: options.capturedAt,
    width: 320,
    height: 180,
    image: { mimeType: 'image/png', bytes },
  }
}

async function main(): Promise<void> {
  let now = 10_000
  const realtime = new TestRealtime()
  const reflexAdapter = new TestReflexAdapter()
  const eventExtractor = new TestEventExtractor()
  const gameEvents: GameSemanticEvent[] = []
  reflexAdapter.intents.push({ type: 'pointer-tap', x: 100, y: 75 })
  eventExtractor.events.push({
    type: 'checkpoint',
    importance: 'normal',
    value: 1,
    observedAt: 9_999,
  })
  const controller = new GameSessionController({
    realtime: () => realtime,
    reflex: new AdapterBackedGameReflexPolicy(reflexAdapter),
    eventExtractor,
    onEvent: (event) => {
      gameEvents.push(event)
      if (event.type === 'game-started' || event.type === 'checkpoint') return 'candidate'
      if (event.type === 'game-paused') return 'suppressed-policy'
      if (event.type === 'game-resumed') return 'suppressed-busy'
      if (event.type === 'waiting-user') return 'suppressed-budget'
      if (event.type === 'game-error') return 'candidate'
      return 'not-requested'
    },
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
  const gameStartedEvent = gameEvents.find((event) => event.type === 'game-started')
  assert(gameStartedEvent)
  controller.recordCommentaryOutcome({
    eventId: gameStartedEvent.eventId,
    outcome: 'suppressed-busy',
  })

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
  const checkpointEvent = gameEvents.find((event) => event.type === 'checkpoint')
  assert(checkpointEvent)
  assert.equal(checkpointEvent.at, 9_999)
  assert.equal('observedAt' in checkpointEvent, false)
  assert.throws(() =>
    controller.recordCommentaryOutcome({
      eventId: checkpointEvent.eventId,
      outcome: 'completed',
      unexpected: true,
    } as never),
  )
  controller.recordCommentaryOutcome({ eventId: checkpointEvent.eventId, outcome: 'completed' })
  assert.throws(
    () =>
      controller.recordCommentaryOutcome({
        eventId: checkpointEvent.eventId,
        outcome: 'completed',
      }),
    (error) => error instanceof BrowserGameError && error.code === 'GAME_COMMENTARY_NOT_PENDING',
  )
  assert.equal(controller.status().telemetry.inputEventsPerSecond, 2)
  assert(controller.status().telemetry.gameEvents >= 2)
  assert.equal(controller.status().telemetry.commentCandidates, 2)
  assert.equal(controller.status().telemetry.commentCooldownSuppressions, 0)
  assert.equal(controller.status().telemetry.commentBusySuppressions, 0)
  assert.equal(controller.status().telemetry.commentPolicySuppressions, 0)
  assert.equal(controller.status().telemetry.commentsCompleted, 1)
  assert.equal(controller.status().telemetry.commentAdmissionSuppressions, 1)
  assert.equal(controller.status().telemetry.commentFailures, 0)
  assert.equal(controller.diagnostics().session?.origin, 'https://game.example')
  assert.deepEqual(controller.diagnostics().reflex, reflexAdapter.status())
  assert.deepEqual(controller.diagnostics().eventExtractor, eventExtractor.status())
  assert.equal(JSON.stringify(controller.diagnostics()).includes('authorizationActionId'), false)
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
  assert.equal(reflexAdapter.suspendCount, 1)
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
  assert.equal(controller.status().telemetry.commentCooldownSuppressions, 1)
  assert.equal(controller.status().telemetry.commentBusySuppressions, 1)
  assert.equal(controller.status().telemetry.commentPolicySuppressions, 1)
  assert.equal(controller.status().waitingReason, 'authentication')
  assert(gameEvents.some((event) => event.type === 'waiting-user'))
  assert.equal(reflexAdapter.suspendCount, 2)
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
  const gameErrorEvent = gameEvents.find((event) => event.type === 'game-error')
  assert(gameErrorEvent)
  controller.recordCommentaryOutcome({ eventId: gameErrorEvent.eventId, outcome: 'failed' })
  assert.equal(controller.status().telemetry.commentCandidates, 3)
  assert.equal(controller.status().telemetry.commentFailures, 1)
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

  let telemetryNow = 50_000
  const telemetryRealtime = new TestRealtime()
  const telemetryController = new GameSessionController({
    realtime: () => telemetryRealtime,
    reflex: new AdapterBackedGameReflexPolicy(new TestReflexAdapter()),
    now: () => telemetryNow,
  })
  const telemetryPreparation = await telemetryController.prepareStart(
    { goal: 'Measure bounded local game telemetry' },
    new AbortController().signal,
  )
  await telemetryController.start(
    telemetryPreparation.preparationId,
    'action-60000-66666666-6666-4666-8666-666666666666',
    new AbortController().signal,
  )
  for (let frameId = 6; frameId <= 8; frameId += 1) {
    await waitUntil(() => telemetryRealtime.capturePending())
    telemetryNow += 100
    telemetryRealtime.emit({
      sessionId: telemetryRealtime.binding?.sessionId ?? '',
      tabId: telemetryRealtime.binding?.tabId ?? '',
      frameId,
      capturedAt: telemetryNow,
      width: 640,
      height: 360,
      viewport: { width: 1_280, height: 720, pageScaleFactor: 1 },
      image: { mimeType: 'image/jpeg', bytes },
    })
  }
  await waitUntil(() => telemetryController.status().telemetry.capturedFrames === 3)
  assert.equal(telemetryController.status().telemetry.captureFps, 10)
  assert.equal(telemetryController.status().telemetry.sessionDurationMs, 300)
  await telemetryController.stop()

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

  const localEvents = new LocalVisualGameEventExtractor()
  assert.deepEqual(localEvents.status(), {
    backendId: 'local-temporal-events-v1',
    mode: 'local-temporal',
    ready: true,
    sampleRateHz: 2,
    semanticPerception: false,
  })
  const localEventSignal = new AbortController().signal
  const detected: ExtractedGameEvent[] = []
  for (let second = 0; second <= 8; second += 1) {
    detected.push(
      ...(await localEvents.extract(
        await visualTargetFrame({ frameId: second + 1, capturedAt: second * 1_000 }),
        { strategy: 'balanced', elapsedMs: second * 1_000, inputEvents: second * 2 },
        localEventSignal,
      )),
    )
  }
  assert.deepEqual(detected, [
    { type: 'stuck', importance: 'normal', label: 'visual-state-stable' },
  ])
  assert.deepEqual(
    await localEvents.extract(
      await visualTargetFrame({ frameId: 10, capturedAt: 9_000 }),
      { strategy: 'balanced', elapsedMs: 9_000, inputEvents: 18 },
      localEventSignal,
    ),
    [],
    'stable state must emit stuck only once',
  )
  assert.deepEqual(
    await localEvents.extract(
      await visualTargetFrame({ frameId: 11, capturedAt: 10_000, targetX: 220 }),
      { strategy: 'balanced', elapsedMs: 10_000, inputEvents: 20 },
      localEventSignal,
    ),
    [],
    'visual change must open a fresh observation window',
  )
  const cancelledExtraction = new AbortController()
  cancelledExtraction.abort()
  await assert.rejects(
    localEvents.extract(
      await visualTargetFrame({ frameId: 12, capturedAt: 11_000, targetX: 220 }),
      { strategy: 'balanced', elapsedMs: 11_000, inputEvents: 22 },
      cancelledExtraction.signal,
    ),
    { name: 'AbortError' },
  )
  localEvents.reset()
  assert.deepEqual(
    await localEvents.extract(
      await visualTargetFrame({ frameId: 13, capturedAt: 20_000 }),
      { strategy: 'balanced', elapsedMs: 20_000, inputEvents: 100 },
      localEventSignal,
    ),
    [],
  )
  assert.deepEqual(
    await localEvents.extract(
      await visualTargetFrame({ frameId: 14, capturedAt: 29_000 }),
      { strategy: 'balanced', elapsedMs: 29_000, inputEvents: 100 },
      localEventSignal,
    ),
    [],
    'a static passive scene must not be called stuck without repeated input',
  )

  const semantic = new TestSemanticPerceptionAdapter()
  const hybridEvents = new HybridGameEventExtractor(new LocalVisualGameEventExtractor(), semantic)
  assert.deepEqual(hybridEvents.status(), {
    backendId: 'hybrid-fixture-semantic',
    mode: 'low-frequency-semantic',
    ready: true,
    sampleRateHz: 0.2,
    semanticPerception: true,
  })
  const semanticState = { strategy: 'balanced' as const, elapsedMs: 30_000, inputEvents: 10 }
  semantic.snapshots.push({
    phase: 'playing',
    score: 0,
    lives: 3,
    checkpoint: null,
    levelCompleted: false,
    newRecord: false,
    label: 'Round active',
    confidence: 0.95,
  })
  assert.deepEqual(
    await hybridEvents.extract(
      await visualTargetFrame({ frameId: 20, capturedAt: 30_000, targetX: 160 }),
      semanticState,
      localEventSignal,
    ),
    [],
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(
    await hybridEvents.extract(
      await visualTargetFrame({ frameId: 21, capturedAt: 30_100, targetX: 160 }),
      semanticState,
      localEventSignal,
    ),
    [],
    'the first semantic sample establishes a baseline without inventing events',
  )
  semantic.snapshots.push({
    phase: 'game-over',
    score: 1,
    lives: 2,
    checkpoint: 'gate-1',
    levelCompleted: false,
    newRecord: false,
    label: 'Round failed',
    confidence: 0.91,
  })
  assert.deepEqual(
    await hybridEvents.extract(
      await visualTargetFrame({ frameId: 22, capturedAt: 35_000, targetX: 190 }),
      semanticState,
      localEventSignal,
    ),
    [],
    'slow semantic analysis must not back-pressure local extraction',
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(
    await hybridEvents.extract(
      await visualTargetFrame({ frameId: 23, capturedAt: 35_100, targetX: 190 }),
      semanticState,
      localEventSignal,
    ),
    [
      {
        type: 'score-changed',
        importance: 'ambient',
        previousValue: 0,
        value: 1,
        label: 'Round failed',
        observedAt: 35_000,
      },
      {
        type: 'life-lost',
        importance: 'normal',
        previousValue: 3,
        value: 2,
        label: 'Round failed',
        observedAt: 35_000,
      },
      {
        type: 'checkpoint',
        importance: 'normal',
        label: 'Round failed',
        observedAt: 35_000,
      },
      {
        type: 'game-over',
        importance: 'important',
        label: 'Round failed',
        observedAt: 35_000,
      },
    ],
  )
  semantic.snapshots.push({
    phase: 'playing',
    score: 1,
    lives: 2,
    checkpoint: 'gate-1',
    levelCompleted: false,
    newRecord: false,
    label: 'Retry active',
    confidence: 0.9,
  })
  await hybridEvents.extract(
    await visualTargetFrame({ frameId: 24, capturedAt: 40_000, targetX: 160 }),
    semanticState,
    localEventSignal,
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(
    await hybridEvents.extract(
      await visualTargetFrame({ frameId: 25, capturedAt: 40_100, targetX: 160 }),
      semanticState,
      localEventSignal,
    ),
    [{ type: 'retry', importance: 'ambient', label: 'Retry active', observedAt: 40_000 }],
  )
  semantic.snapshots.push({
    phase: 'playing',
    score: 999,
    lives: 2,
    checkpoint: 'gate-1',
    levelCompleted: false,
    newRecord: false,
    label: 'Uncertain score',
    confidence: 0.4,
  })
  await hybridEvents.extract(
    await visualTargetFrame({ frameId: 26, capturedAt: 45_000, targetX: 160 }),
    semanticState,
    localEventSignal,
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(
    await hybridEvents.extract(
      await visualTargetFrame({ frameId: 27, capturedAt: 45_100, targetX: 160 }),
      semanticState,
      localEventSignal,
    ),
    [],
    'low-confidence model output must neither emit nor replace the trusted baseline',
  )
  semantic.deferNext = true
  await hybridEvents.extract(
    await visualTargetFrame({ frameId: 28, capturedAt: 50_000, targetX: 160 }),
    semanticState,
    localEventSignal,
  )
  await waitUntil(() => semantic.calls.length === 5)
  const deferredSignal = semantic.calls.at(-1)?.signal
  hybridEvents.reset()
  assert.equal(deferredSignal?.aborted, true)
  assert.equal(semantic.resetCount, 1)
  semantic.ready = false
  assert.equal(hybridEvents.status().mode, 'local-temporal')
  assert.equal(hybridEvents.status().semanticPerception, false)

  const visionProvider = new TestVisionProvider()
  visionProvider.response =
    '```json\n{"phase":"playing","score":7,"lives":3,"checkpoint":null,"levelCompleted":false,"newRecord":false,"label":"Score seven","confidence":0.88}\n```'
  const visionAdapter = new LlmGameSemanticPerceptionAdapter({ provider: () => visionProvider })
  assert.equal(visionAdapter.status().ready, true)
  const visionFrame = await visualTargetFrame({ frameId: 30, capturedAt: 60_000, targetX: 160 })
  assert.deepEqual(
    await visionAdapter.analyze(visionFrame, semanticState, null, localEventSignal),
    {
      phase: 'playing',
      score: 7,
      lives: 3,
      checkpoint: null,
      levelCompleted: false,
      newRecord: false,
      label: 'Score seven',
      confidence: 0.88,
    },
  )
  assert.equal(visionProvider.calls.length, 1)
  assert.equal(visionProvider.calls[0]?.options?.timeoutMs, 5_000)
  assert.equal(visionProvider.calls[0]?.options?.signal, localEventSignal)
  const visionContent = visionProvider.calls[0]?.messages[1]?.content
  assert(Array.isArray(visionContent))
  const imagePart = visionContent.find((part) => part.type === 'image')
  assert(imagePart?.type === 'image')
  assert.equal(imagePart.bytes, visionFrame.image.bytes)
  visionProvider.response =
    '{"phase":"playing","score":7,"lives":3,"checkpoint":null,"levelCompleted":false,"newRecord":false,"label":null,"confidence":0.88,"extra":"rejected"}'
  await assert.rejects(visionAdapter.analyze(visionFrame, semanticState, null, localEventSignal))
  visionProvider.supportsVision = false
  assert.equal(visionAdapter.status().ready, false)
  assert.equal(
    await visionAdapter.analyze(visionFrame, semanticState, null, localEventSignal),
    null,
  )
  assert.equal(visionProvider.calls.length, 2)

  const localReflex = new LocalVisualTargetReflexAdapter()
  const localScope: GameSessionScope = {
    sessionId: 'game-session-77777777-7777-4777-8777-777777777777',
    authorizationActionId: 'action-70000-77777777-7777-4777-8777-777777777777',
    browserSessionId: 'browser-session-77777777-7777-4777-8777-777777777777',
    tabId: 'tab-local-target',
    origin: 'https://game.example',
    url: 'https://game.example/target',
    gameSurface: realtime.surface,
    allowedInputs: ['pointer'],
    maxDurationMs: 300_000,
    maxInputEvents: 5_000,
    maxInputEventsPerSecond: 15,
    navigation: 'same-origin-only',
    startedAt: 70_000,
    expiresAt: 370_000,
  }
  const localSignal = new AbortController().signal
  await localReflex.initialize(
    { goal: 'Track the bounded pointer target', strategy: 'balanced', scope: localScope },
    localSignal,
  )
  assert.equal(localReflex.status().mode, 'local-visual')
  assert.equal(localReflex.status().ready, true)
  assert.deepEqual(localReflex.status().supportedInputs, ['pointer'])
  assert.equal(localReflex.status().semanticPerception, false)
  const localState = { strategy: 'balanced' as const, elapsedMs: 0, inputEvents: 0 }
  const firstTarget = await localReflex.decide(
    await visualTargetFrame({ frameId: 1, capturedAt: 70_000, targetX: 160 }),
    localState,
    localSignal,
  )
  assert.equal(firstTarget.type, 'pointer-down')
  if (firstTarget.type === 'pointer-down') {
    assert(Math.abs(firstTarget.x - 160) < 3)
    assert(Math.abs(firstTarget.y - 90) < 3)
  }
  const firstRelease = await localReflex.decide(
    await visualTargetFrame({ frameId: 2, capturedAt: 70_200, targetX: 160 }),
    localState,
    localSignal,
  )
  assert.equal(firstRelease.type, 'pointer-up')
  if (firstRelease.type === 'pointer-up' && firstTarget.type === 'pointer-down') {
    assert.deepEqual(firstRelease, { type: 'pointer-up', x: firstTarget.x, y: firstTarget.y })
  }
  const movedTarget = await localReflex.decide(
    await visualTargetFrame({ frameId: 3, capturedAt: 70_600, targetX: 190 }),
    localState,
    localSignal,
  )
  assert.equal(movedTarget.type, 'pointer-down')
  const movedRelease = await localReflex.decide(
    await visualTargetFrame({ frameId: 4, capturedAt: 70_800 }),
    localState,
    localSignal,
  )
  assert.equal(movedRelease.type, 'pointer-up')
  if (movedRelease.type === 'pointer-up' && movedTarget.type === 'pointer-down') {
    assert.deepEqual(movedRelease, { type: 'pointer-up', x: movedTarget.x, y: movedTarget.y })
  }
  const reacquired = await localReflex.decide(
    await visualTargetFrame({ frameId: 5, capturedAt: 71_400 }),
    localState,
    localSignal,
  )
  assert.equal(reacquired.type, 'pointer-down')
  localReflex.suspend()
  assert.deepEqual(
    await localReflex.decide(
      await visualTargetFrame({ frameId: 6, capturedAt: 72_000 }),
      localState,
      localSignal,
    ),
    { type: 'none' },
  )
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(
    localReflex.decide(
      await visualTargetFrame({ frameId: 7, capturedAt: 72_500, targetX: 220 }),
      localState,
      cancelled.signal,
    ),
    { name: 'AbortError' },
  )
  const bundledRealtime = new TestRealtime()
  const bundledPlugin = new BrowserGamePlugin({ realtime: () => bundledRealtime })
  await bundledPlugin.initialize({ pluginId: 'browser-game-control' })
  await bundledPlugin.start()
  assert.equal(bundledPlugin.getHealth().state, 'healthy')
  assert.deepEqual(bundledPlugin.getCapabilityProjection(), {
    backendId: 'local-visual-targets-v1',
    mode: 'local-visual',
    ready: true,
    supportedInputs: ['pointer'],
    semanticPerception: false,
  })
  await assert.rejects(
    bundledPlugin
      .getBrowserGameControlProvider()
      .prepareStart(
        { goal: 'Play a keyboard-only fixture', allowedInputs: ['keyboard'] },
        new AbortController().signal,
      ),
    (error: unknown) =>
      error instanceof BrowserGameError && error.code === 'GAME_REFLEX_UNSUPPORTED_INPUT',
  )
  await bundledPlugin.dispose()
  console.log('browser game controller repro passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
