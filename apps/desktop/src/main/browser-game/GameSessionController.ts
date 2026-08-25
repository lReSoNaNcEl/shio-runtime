import { randomUUID } from 'node:crypto'

import sharp from 'sharp'

import {
  type BrowserGameDiagnostics,
  BrowserGameError,
  type BrowserGameErrorCode,
  type BrowserGameStatus,
  type CharacterGameStartRequest,
  characterGameStartRequestSchema,
  GAME_FRAME_MAX_AGE_MS,
  type GameFrame,
  type GameInputIntent,
  type GameSemanticEvent,
  type GameSemanticEventType,
  type GameSessionScope,
  type GameSessionTelemetry,
  type GameStartPreparation,
  type GameStrategy,
  gameReflexBackendStatusSchema,
  gameSemanticEventSchema,
} from '../../shared/browser-game'
import type {
  BrowserGameBlockerKind,
  BrowserGameEnvironmentInspection,
  BrowserGameSurfaceCandidate,
  BrowserRealtimeControlProvider,
  BrowserRealtimeInputEvent,
  BrowserRealtimeSession,
  BrowserRealtimeViewport,
} from '../../shared/desktop-control'
import { mainLog } from '../logging/safeLogger'
import {
  type ExtractedGameEvent,
  GameEventExtractionLane,
  type GameEventExtractor,
} from './GameEventExtractor'
import type { GameReflexPolicy } from './GameReflexPolicy'

const PREPARATION_TTL_MS = 30_000
const LATENCY_SAMPLE_LIMIT = 240
const GAME_ENVIRONMENT_INSPECTION_INTERVAL_MS = 2_000
const ALLOWED_GAME_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Enter',
  'Space',
  'a',
  'd',
  's',
  'w',
])

export interface GameSessionControllerOptions {
  realtime(): BrowserRealtimeControlProvider | undefined
  reflex: GameReflexPolicy
  eventExtractor?: GameEventExtractor
  onEvent?: (event: GameSemanticEvent) => void
  now?: () => number
  createId?: () => string
}

interface ActiveGameSession {
  goal: string
  scope: GameSessionScope
  strategy: GameStrategy
  controller: AbortController
  realtime: BrowserRealtimeControlProvider
  loopTask: Promise<void> | null
  inputTimestamps: number[]
  reflexInitialized: boolean
  hasRun: boolean
  environmentInspectionInFlight: boolean
  nextEnvironmentInspectionAt: number
}

interface MutableTelemetry extends GameSessionTelemetry {
  captureLatencies: number[]
  decisionLatencies: number[]
  inputLatencies: number[]
  captureTimestamps: number[]
}

function emptyTelemetry(): MutableTelemetry {
  return {
    capturedFrames: 0,
    droppedFrames: 0,
    staleDecisions: 0,
    inputEvents: 0,
    gameEvents: 0,
    captureFps: 0,
    inputEventsPerSecond: 0,
    sessionDurationMs: 0,
    captureLatencies: [],
    decisionLatencies: [],
    inputLatencies: [],
    captureTimestamps: [],
  }
}

function percentile50(samples: readonly number[]): number | undefined {
  if (samples.length === 0) return undefined
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

function recordSample(samples: number[], value: number): void {
  samples.push(Math.max(0, Math.round(value)))
  if (samples.length > LATENCY_SAMPLE_LIMIT)
    samples.splice(0, samples.length - LATENCY_SAMPLE_LIMIT)
}

function boundedStatusTelemetry(
  telemetry: MutableTelemetry,
  now: number,
  inputTimestamps: readonly number[],
): GameSessionTelemetry {
  const recentCaptures = telemetry.captureTimestamps.filter((timestamp) => now - timestamp < 2_000)
  const captureSpan =
    recentCaptures.length > 1 ? (recentCaptures.at(-1) ?? now) - (recentCaptures[0] ?? now) : 0
  const captureFps =
    captureSpan > 0
      ? Math.min(60, Math.round((((recentCaptures.length - 1) * 1_000) / captureSpan) * 10) / 10)
      : 0
  const startedAt = telemetry.startedAt
  const sessionDurationMs =
    startedAt === undefined ? 0 : Math.max(0, (telemetry.stoppedAt ?? now) - startedAt)
  return {
    capturedFrames: telemetry.capturedFrames,
    droppedFrames: telemetry.droppedFrames,
    staleDecisions: telemetry.staleDecisions,
    inputEvents: telemetry.inputEvents,
    gameEvents: telemetry.gameEvents,
    captureFps,
    inputEventsPerSecond: inputTimestamps.filter((timestamp) => now - timestamp < 1_000).length,
    sessionDurationMs,
    ...(percentile50(telemetry.captureLatencies) !== undefined
      ? { captureLatencyMsP50: percentile50(telemetry.captureLatencies) }
      : {}),
    ...(percentile50(telemetry.decisionLatencies) !== undefined
      ? { decisionLatencyMsP50: percentile50(telemetry.decisionLatencies) }
      : {}),
    ...(percentile50(telemetry.inputLatencies) !== undefined
      ? { inputLatencyMsP50: percentile50(telemetry.inputLatencies) }
      : {}),
    ...(telemetry.startedAt !== undefined ? { startedAt: telemetry.startedAt } : {}),
    ...(telemetry.stoppedAt !== undefined ? { stoppedAt: telemetry.stoppedAt } : {}),
  }
}

function sameBinding(
  session: BrowserRealtimeSession | null,
  expected: Pick<
    GameStartPreparation,
    'browserSessionId' | 'tabId' | 'origin' | 'url' | 'navigation'
  >,
): boolean {
  return (
    session?.sessionId === expected.browserSessionId &&
    session.tabId === expected.tabId &&
    session.origin === expected.origin &&
    (expected.navigation !== 'none' || session.url === expected.url)
  )
}

function visibleSurface(
  candidate: BrowserGameSurfaceCandidate,
  viewport: BrowserRealtimeViewport,
): BrowserGameSurfaceCandidate | null {
  const left = Math.max(0, candidate.bounds.x)
  const top = Math.max(0, candidate.bounds.y)
  const right = Math.min(viewport.width, candidate.bounds.x + candidate.bounds.width)
  const bottom = Math.min(viewport.height, candidate.bounds.y + candidate.bounds.height)
  if (right - left < 32 || bottom - top < 32) return null
  return { ...candidate, bounds: { x: left, y: top, width: right - left, height: bottom - top } }
}

function sameBounds(
  current: BrowserGameSurfaceCandidate['bounds'],
  expected: BrowserGameSurfaceCandidate['bounds'],
): boolean {
  return (['x', 'y', 'width', 'height'] as const).every(
    (key) => Math.abs(current[key] - expected[key]) <= 1,
  )
}

export class GameSessionController {
  private preparation: GameStartPreparation | null = null
  private active: ActiveGameSession | null = null
  private state: BrowserGameStatus['state'] = 'idle'
  private strategy: GameStrategy = 'balanced'
  private telemetry = emptyTelemetry()
  private lastErrorCode: string | undefined
  private waitingReason: BrowserGameBlockerKind | undefined
  private readonly listeners = new Set<() => void>()
  private readonly eventLane: GameEventExtractionLane | null

  constructor(private readonly options: GameSessionControllerOptions) {
    this.eventLane = options.eventExtractor
      ? new GameEventExtractionLane(
          options.eventExtractor,
          (events, frame) => this.publishExtractedEvents(events, frame),
          (error) => mainLog.warn('[BrowserGame] event extraction failed', error),
        )
      : null
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async discoverSurfaces(signal: AbortSignal): Promise<readonly BrowserGameSurfaceCandidate[]> {
    const realtime = this.requireRealtime()
    const session = realtime.session()
    if (!session) throw new BrowserGameError('GAME_CAPABILITY_UNAVAILABLE')
    const viewport = await realtime.getViewport()
    if (signal.aborted) throw signal.reason ?? new BrowserGameError('GAME_CAPABILITY_UNAVAILABLE')
    return (await realtime.inspectGameEnvironment(signal)).surfaces.flatMap(
      (candidate): BrowserGameSurfaceCandidate[] => {
        const visible = visibleSurface(candidate, viewport)
        return visible ? [visible] : []
      },
    )
  }

  async prepareStart(
    request: CharacterGameStartRequest,
    signal: AbortSignal,
  ): Promise<GameStartPreparation> {
    if (this.active && ['starting', 'running', 'paused', 'waiting-user'].includes(this.state)) {
      throw new BrowserGameError('GAME_SESSION_ACTIVE')
    }
    const input = characterGameStartRequestSchema.parse(request)
    const realtime = this.requireRealtime()
    const session = realtime.session()
    if (!session) throw new BrowserGameError('GAME_CAPABILITY_UNAVAILABLE')
    const surfaces = await this.discoverSurfaces(signal)
    const surface = input.surfaceId
      ? surfaces.find((candidate) => candidate.id === input.surfaceId)
      : surfaces.length === 1
        ? surfaces[0]
        : undefined
    if (!surface) {
      throw new BrowserGameError(
        surfaces.length > 1 ? 'GAME_SURFACE_SELECTION_REQUIRED' : 'GAME_SURFACE_NOT_FOUND',
        surfaces,
      )
    }
    const now = this.now()
    this.preparation = {
      preparationId: `game-preparation-${this.createId()}`,
      goal: input.goal,
      browserSessionId: session.sessionId,
      tabId: session.tabId,
      origin: session.origin,
      url: session.url,
      surface,
      allowedInputs: Object.freeze([...input.allowedInputs]),
      maxDurationMs: input.maxDurationMs,
      maxInputEvents: input.maxInputEvents,
      maxInputEventsPerSecond: input.maxInputEventsPerSecond,
      navigation: input.navigation,
      strategy: input.strategy,
      createdAt: now,
      expiresAt: now + PREPARATION_TTL_MS,
    }
    return this.copyPreparation(this.preparation)
  }

  prepared(preparationId: string): GameStartPreparation {
    const preparation = this.preparation
    if (
      !preparation ||
      preparation.preparationId !== preparationId ||
      preparation.expiresAt <= this.now()
    ) {
      throw new BrowserGameError('GAME_PREPARATION_EXPIRED')
    }
    return this.copyPreparation(preparation)
  }

  async start(
    preparationId: string,
    authorizationActionId: string,
    signal: AbortSignal,
  ): Promise<BrowserGameStatus> {
    if (!/^action-[0-9]+-[0-9a-f-]{36}$/iu.test(authorizationActionId)) {
      throw new BrowserGameError('GAME_PREPARATION_EXPIRED')
    }
    if (this.active && ['starting', 'running', 'paused', 'waiting-user'].includes(this.state)) {
      throw new BrowserGameError('GAME_SESSION_ACTIVE')
    }
    const preparation = this.prepared(preparationId)
    const realtime = this.requireRealtime()
    if (!sameBinding(realtime.session(), preparation)) {
      throw new BrowserGameError('GAME_SCOPE_CHANGED')
    }
    this.preparation = null
    const now = this.now()
    const scope: GameSessionScope = {
      sessionId: `game-session-${this.createId()}`,
      authorizationActionId,
      browserSessionId: preparation.browserSessionId,
      tabId: preparation.tabId,
      origin: preparation.origin,
      url: preparation.url,
      gameSurface: { ...preparation.surface, bounds: { ...preparation.surface.bounds } },
      allowedInputs: Object.freeze([...preparation.allowedInputs]),
      maxDurationMs: preparation.maxDurationMs,
      maxInputEvents: preparation.maxInputEvents,
      maxInputEventsPerSecond: preparation.maxInputEventsPerSecond,
      navigation: preparation.navigation,
      startedAt: now,
      expiresAt: now + preparation.maxDurationMs,
    }
    const controller = new AbortController()
    this.active = {
      goal: preparation.goal,
      scope,
      strategy: preparation.strategy,
      controller,
      realtime,
      loopTask: null,
      inputTimestamps: [],
      reflexInitialized: false,
      hasRun: false,
      environmentInspectionInFlight: false,
      nextEnvironmentInspectionAt: now + GAME_ENVIRONMENT_INSPECTION_INTERVAL_MS,
    }
    const active = this.active
    this.state = 'starting'
    this.strategy = preparation.strategy
    this.lastErrorCode = undefined
    this.waitingReason = undefined
    this.telemetry = { ...emptyTelemetry(), startedAt: now }
    this.eventLane?.reset()
    this.publishChanged()
    const abortStart = (): void => controller.abort(signal.reason)
    signal.addEventListener('abort', abortStart, { once: true })
    try {
      const environment = await realtime.inspectGameEnvironment(controller.signal)
      if (environment.blocker) {
        await this.enterWaitingUser(active, environment.blocker)
        return this.status()
      }
      this.assertEnvironmentScope(environment, scope)
      await this.options.reflex.initialize(
        { goal: preparation.goal, strategy: preparation.strategy, scope },
        controller.signal,
      )
      active.reflexInitialized = true
    } catch (error) {
      await realtime.releaseInputs()
      this.options.reflex.reset()
      this.eventLane?.reset()
      this.active = null
      this.state = 'error'
      this.lastErrorCode = error instanceof BrowserGameError ? error.code : 'GAME_LOOP_FAILED'
      this.telemetry.stoppedAt = this.now()
      this.publishGameEvent(scope, 'game-error', 'important', { reason: 'error' })
      this.publishChanged()
      throw error
    } finally {
      signal.removeEventListener('abort', abortStart)
    }
    if (controller.signal.aborted) {
      await realtime.releaseInputs()
      this.options.reflex.reset()
      this.eventLane?.reset()
      this.publishGameEvent(scope, 'game-stopped', 'normal', { reason: 'user' })
      this.active = null
      this.state = 'stopped'
      this.telemetry.stoppedAt = this.now()
      this.publishChanged()
      throw controller.signal.reason ?? new BrowserGameError('GAME_LOOP_FAILED')
    }
    this.state = 'running'
    active.loopTask = this.runLoop(active).catch(async (error) => {
      if (!active.controller.signal.aborted) await this.failSession(error)
    })
    active.hasRun = true
    this.publishGameEvent(scope, 'game-started', 'normal')
    this.publishChanged()
    return this.status()
  }

  async pause(): Promise<BrowserGameStatus> {
    const active = this.requireActive(['running', 'waiting-user'])
    this.state = 'paused'
    this.waitingReason = undefined
    if (!active.controller.signal.aborted) {
      active.controller.abort(new BrowserGameError('GAME_SESSION_NOT_RUNNING'))
    }
    await active.loopTask
    active.loopTask = null
    await active.realtime.releaseInputs()
    this.publishGameEvent(active.scope, 'game-paused', 'ambient', { reason: 'user' })
    this.publishChanged()
    return this.status()
  }

  async resume(): Promise<BrowserGameStatus> {
    const active = this.requireActive(['paused', 'waiting-user'])
    if (!sameBinding(active.realtime.session(), active.scope)) {
      await this.stopWithError('GAME_SCOPE_CHANGED')
      throw new BrowserGameError('GAME_SCOPE_CHANGED')
    }
    active.controller = new AbortController()
    active.environmentInspectionInFlight = false
    this.state = 'starting'
    this.waitingReason = undefined
    this.publishChanged()
    try {
      const environment = await active.realtime.inspectGameEnvironment(active.controller.signal)
      if (environment.blocker) {
        await this.enterWaitingUser(active, environment.blocker)
        return this.status()
      }
      this.assertEnvironmentScope(environment, active.scope)
      if (!active.reflexInitialized) {
        await this.options.reflex.initialize(
          { goal: active.goal, strategy: active.strategy, scope: active.scope },
          active.controller.signal,
        )
        active.reflexInitialized = true
      }
    } catch (error) {
      await this.failSession(error)
      throw error
    }
    active.nextEnvironmentInspectionAt = this.now() + GAME_ENVIRONMENT_INSPECTION_INTERVAL_MS
    this.state = 'running'
    active.loopTask = this.runLoop(active).catch(async (error) => {
      if (!active.controller.signal.aborted) await this.failSession(error)
    })
    const resumed = active.hasRun
    this.publishGameEvent(
      active.scope,
      resumed ? 'game-resumed' : 'game-started',
      resumed ? 'ambient' : 'normal',
      { reason: 'user' },
    )
    active.hasRun = true
    this.publishChanged()
    return this.status()
  }

  async stop(
    reason: 'user' | 'expired' | 'scope-changed' | 'blocked' | 'error' | 'completed' = 'user',
  ): Promise<BrowserGameStatus> {
    const active = this.active
    if (!active) {
      this.preparation = null
      this.state = this.state === 'idle' ? 'idle' : 'stopped'
      return this.status()
    }
    this.state = 'stopping'
    this.publishChanged()
    active.controller.abort(new BrowserGameError('GAME_SESSION_NOT_RUNNING'))
    await active.loopTask
    await active.realtime.releaseInputs()
    this.options.reflex.reset()
    this.eventLane?.reset()
    this.publishGameEvent(active.scope, 'game-stopped', 'normal', { reason })
    this.active = null
    this.state = 'stopped'
    this.waitingReason = undefined
    this.telemetry.stoppedAt = this.now()
    this.publishChanged()
    return this.status()
  }

  updateStrategy(strategy: GameStrategy): BrowserGameStatus {
    this.strategy = strategy
    if (this.active) this.active.strategy = strategy
    this.options.reflex.updateStrategy?.(strategy)
    this.publishChanged()
    return this.status()
  }

  status(): BrowserGameStatus {
    const now = this.now()
    return {
      state: this.state,
      ...(this.active ? { scope: this.copyScope(this.active.scope) } : {}),
      ...(this.state === 'waiting-user' && this.waitingReason
        ? { waitingReason: this.waitingReason }
        : {}),
      strategy: this.strategy,
      telemetry: boundedStatusTelemetry(this.telemetry, now, this.active?.inputTimestamps ?? []),
      ...(this.lastErrorCode ? { lastErrorCode: this.lastErrorCode } : {}),
    }
  }

  diagnostics(): BrowserGameDiagnostics {
    const status = this.status()
    return {
      state: status.state,
      ...(status.waitingReason ? { waitingReason: status.waitingReason } : {}),
      strategy: status.strategy,
      reflex: gameReflexBackendStatusSchema.parse(this.options.reflex.status()),
      ...(this.active
        ? {
            session: {
              title: (this.active.scope.gameSurface.label || this.active.goal).slice(0, 500),
              origin: this.active.scope.origin,
              startedAt: this.active.scope.startedAt,
              expiresAt: this.active.scope.expiresAt,
            },
          }
        : {}),
      telemetry: status.telemetry,
      ...(status.lastErrorCode ? { lastErrorCode: status.lastErrorCode } : {}),
    }
  }

  private async runLoop(active: ActiveGameSession): Promise<void> {
    const realtime = active.realtime
    while (
      !active.controller.signal.aborted &&
      this.active === active &&
      this.state === 'running'
    ) {
      if (this.now() >= active.scope.expiresAt) {
        await this.stopFromLoop(active)
        return
      }
      if (!sameBinding(realtime.session(), active.scope)) {
        throw new BrowserGameError('GAME_SCOPE_CHANGED')
      }
      this.scheduleEnvironmentInspection(active)
      const captureStarted = this.now()
      const source = await realtime.captureFrame(
        {
          sessionId: active.scope.browserSessionId,
          tabId: active.scope.tabId,
          maxFrameAgeMs: GAME_FRAME_MAX_AGE_MS,
        },
        active.controller.signal,
      )
      recordSample(this.telemetry.captureLatencies, this.now() - captureStarted)
      this.telemetry.capturedFrames += 1
      this.telemetry.captureTimestamps.push(this.now())
      this.telemetry.captureTimestamps = this.telemetry.captureTimestamps.filter(
        (timestamp) => this.now() - timestamp < 2_000,
      )
      const frame = await this.cropFrame(source, active.scope)
      if (!frame) {
        this.telemetry.droppedFrames += 1
        continue
      }
      const decisionStarted = this.now()
      const reflexState = {
        strategy: active.strategy,
        elapsedMs: this.now() - active.scope.startedAt,
        inputEvents: this.telemetry.inputEvents,
      }
      this.eventLane?.offer(frame, reflexState, active.controller.signal)
      const intent = await this.options.reflex.decide(frame, reflexState, active.controller.signal)
      recordSample(this.telemetry.decisionLatencies, this.now() - decisionStarted)
      if (this.now() - frame.capturedAt > GAME_FRAME_MAX_AGE_MS) {
        this.telemetry.staleDecisions += 1
        continue
      }
      const events = this.validateIntent(intent, frame, active)
      if (events.length === 0) continue
      const inputStarted = this.now()
      await realtime.dispatchInput(
        {
          sessionId: active.scope.browserSessionId,
          tabId: active.scope.tabId,
          events,
        },
        active.controller.signal,
      )
      recordSample(this.telemetry.inputLatencies, this.now() - inputStarted)
      this.telemetry.inputEvents += events.length
      this.publishChanged()
    }
  }

  private scheduleEnvironmentInspection(active: ActiveGameSession): void {
    const now = this.now()
    if (active.environmentInspectionInFlight || now < active.nextEnvironmentInspectionAt) return
    active.environmentInspectionInFlight = true
    active.nextEnvironmentInspectionAt = now + GAME_ENVIRONMENT_INSPECTION_INTERVAL_MS
    void this.inspectEnvironment(active)
  }

  private async inspectEnvironment(active: ActiveGameSession): Promise<void> {
    const controller = active.controller
    try {
      const environment = await active.realtime.inspectGameEnvironment(controller.signal)
      if (
        this.active !== active ||
        active.controller !== controller ||
        this.state !== 'running' ||
        controller.signal.aborted
      ) {
        return
      }
      if (environment.blocker) {
        await this.enterWaitingUser(active, environment.blocker)
        return
      }
      this.assertEnvironmentScope(environment, active.scope)
    } catch (error) {
      if (
        this.active !== active ||
        active.controller !== controller ||
        this.state !== 'running' ||
        controller.signal.aborted
      ) {
        return
      }
      await this.failSession(error)
    } finally {
      if (active.controller === controller) active.environmentInspectionInFlight = false
    }
  }

  private async enterWaitingUser(
    active: ActiveGameSession,
    reason: BrowserGameBlockerKind,
  ): Promise<void> {
    if (this.active !== active) return
    this.state = 'waiting-user'
    this.waitingReason = reason
    active.controller.abort(new BrowserGameError('GAME_SESSION_NOT_RUNNING'))
    await active.loopTask
    active.loopTask = null
    active.inputTimestamps = []
    await active.realtime.releaseInputs()
    this.eventLane?.reset()
    this.publishGameEvent(active.scope, 'waiting-user', 'blocking', {
      label: reason,
      reason: 'blocked',
    })
    this.publishChanged()
  }

  private assertEnvironmentScope(
    environment: BrowserGameEnvironmentInspection,
    scope: GameSessionScope,
  ): void {
    const current = environment.surfaces.find(
      (candidate) =>
        candidate.id === scope.gameSurface.id && candidate.kind === scope.gameSurface.kind,
    )
    if (!current || !sameBounds(current.bounds, scope.gameSurface.bounds)) {
      throw new BrowserGameError('GAME_SCOPE_CHANGED')
    }
  }

  private async cropFrame(
    source: Awaited<ReturnType<BrowserRealtimeControlProvider['captureFrame']>>,
    scope: GameSessionScope,
  ): Promise<GameFrame | null> {
    const scaleX = source.width / source.viewport.width
    const scaleY = source.height / source.viewport.height
    const bounds = scope.gameSurface.bounds
    const left = Math.max(0, Math.floor(bounds.x * scaleX))
    const top = Math.max(0, Math.floor(bounds.y * scaleY))
    const width = Math.min(source.width - left, Math.max(1, Math.ceil(bounds.width * scaleX)))
    const height = Math.min(source.height - top, Math.max(1, Math.ceil(bounds.height * scaleY)))
    if (width < 1 || height < 1) return null
    const output = await sharp(source.image.bytes)
      .extract({ left, top, width, height })
      .jpeg({ quality: 70 })
      .toBuffer({ resolveWithObject: true })
    return {
      sessionId: scope.sessionId,
      frameId: source.frameId,
      capturedAt: source.capturedAt,
      width: output.info.width,
      height: output.info.height,
      image: { mimeType: 'image/jpeg', bytes: output.data },
    }
  }

  private validateIntent(
    intent: GameInputIntent,
    frame: GameFrame,
    active: ActiveGameSession,
  ): readonly BrowserRealtimeInputEvent[] {
    if (intent.type === 'none') return []
    const now = this.now()
    active.inputTimestamps = active.inputTimestamps.filter((timestamp) => now - timestamp < 1_000)
    const eventCount = intent.type === 'pointer-tap' || intent.type === 'key-tap' ? 2 : 1
    if (
      this.telemetry.inputEvents + eventCount > active.scope.maxInputEvents ||
      active.inputTimestamps.length + eventCount > active.scope.maxInputEventsPerSecond
    ) {
      throw new BrowserGameError('GAME_SCOPE_EXHAUSTED')
    }
    const events = this.intentEvents(intent, frame, active.scope)
    for (let index = 0; index < events.length; index += 1) active.inputTimestamps.push(now)
    return events
  }

  private intentEvents(
    intent: Exclude<GameInputIntent, { type: 'none' }>,
    frame: GameFrame,
    scope: GameSessionScope,
  ): readonly BrowserRealtimeInputEvent[] {
    if (
      intent.type === 'pointer-tap' ||
      intent.type === 'pointer-down' ||
      intent.type === 'pointer-up'
    ) {
      if (!scope.allowedInputs.includes('pointer')) {
        throw new BrowserGameError('GAME_INPUT_REJECTED')
      }
      if (
        !Number.isFinite(intent.x) ||
        !Number.isFinite(intent.y) ||
        intent.x < 0 ||
        intent.y < 0 ||
        intent.x >= frame.width ||
        intent.y >= frame.height
      ) {
        throw new BrowserGameError('GAME_INPUT_REJECTED')
      }
      const x =
        scope.gameSurface.bounds.x + (intent.x / frame.width) * scope.gameSurface.bounds.width
      const y =
        scope.gameSurface.bounds.y + (intent.y / frame.height) * scope.gameSurface.bounds.height
      if (intent.type === 'pointer-tap') {
        return [
          { type: 'pointer-down', x, y, button: 'left' },
          { type: 'pointer-up', x, y, button: 'left' },
        ]
      }
      return [
        {
          type: intent.type === 'pointer-down' ? 'pointer-down' : 'pointer-up',
          x,
          y,
          button: 'left',
        },
      ]
    }
    if (intent.type !== 'key-tap' && intent.type !== 'key-down' && intent.type !== 'key-up') {
      throw new BrowserGameError('GAME_INPUT_REJECTED')
    }
    if (!scope.allowedInputs.includes('keyboard') || !ALLOWED_GAME_KEYS.has(intent.key)) {
      throw new BrowserGameError('GAME_INPUT_REJECTED')
    }
    if (intent.type === 'key-tap') {
      return [
        { type: 'key-down', key: intent.key },
        { type: 'key-up', key: intent.key },
      ]
    }
    return [{ type: intent.type, key: intent.key }]
  }

  private async stopFromLoop(active: ActiveGameSession): Promise<void> {
    active.controller.abort()
    await active.realtime.releaseInputs()
    this.options.reflex.reset()
    this.eventLane?.reset()
    if (this.active !== active) return
    this.publishGameEvent(active.scope, 'game-stopped', 'normal', { reason: 'expired' })
    this.active = null
    this.state = 'stopped'
    this.waitingReason = undefined
    this.telemetry.stoppedAt = this.now()
    this.publishChanged()
  }

  private async failSession(error: unknown): Promise<void> {
    const active = this.active
    this.lastErrorCode = error instanceof BrowserGameError ? error.code : 'GAME_LOOP_FAILED'
    active?.controller.abort(error)
    await active?.realtime.releaseInputs()
    this.options.reflex.reset()
    this.eventLane?.reset()
    if (active) this.publishGameEvent(active.scope, 'game-error', 'important', { reason: 'error' })
    this.active = null
    this.state = 'error'
    this.waitingReason = undefined
    this.telemetry.stoppedAt = this.now()
    this.publishChanged()
  }

  private async stopWithError(code: BrowserGameErrorCode): Promise<void> {
    const scope = this.active?.scope
    this.lastErrorCode = code
    await this.stop('scope-changed')
    this.state = 'error'
    if (scope) {
      this.publishGameEvent(scope, 'game-error', 'blocking', { reason: 'scope-changed' })
    }
    this.publishChanged()
  }

  private requireRealtime(): BrowserRealtimeControlProvider {
    const provider = this.options.realtime()
    if (!provider) throw new BrowserGameError('GAME_CAPABILITY_UNAVAILABLE')
    return provider
  }

  private requireActive(states: readonly BrowserGameStatus['state'][]): ActiveGameSession {
    if (!this.active || !states.includes(this.state)) {
      throw new BrowserGameError('GAME_SESSION_NOT_RUNNING')
    }
    return this.active
  }

  private copyPreparation(preparation: GameStartPreparation): GameStartPreparation {
    return {
      ...preparation,
      surface: { ...preparation.surface, bounds: { ...preparation.surface.bounds } },
      allowedInputs: [...preparation.allowedInputs],
    }
  }

  private copyScope(scope: GameSessionScope): GameSessionScope {
    return {
      ...scope,
      gameSurface: { ...scope.gameSurface, bounds: { ...scope.gameSurface.bounds } },
      allowedInputs: [...scope.allowedInputs],
    }
  }

  private publishExtractedEvents(events: readonly ExtractedGameEvent[], frame: GameFrame): void {
    const active = this.active
    if (!active || active.scope.sessionId !== frame.sessionId) return
    for (const event of events) {
      const { type, importance, ...details } = event
      this.publishGameEvent(active.scope, type, importance ?? 'normal', details, frame.capturedAt)
    }
  }

  private publishGameEvent(
    scope: GameSessionScope,
    type: GameSemanticEventType,
    importance: GameSemanticEvent['importance'],
    details: Omit<ExtractedGameEvent, 'type' | 'importance'> = {},
    at = this.now(),
  ): void {
    try {
      const event = gameSemanticEventSchema.parse({
        eventId: `game-event-${this.createId()}`,
        sessionId: scope.sessionId,
        type,
        at,
        importance,
        ...details,
      })
      this.telemetry.gameEvents += 1
      this.options.onEvent?.(event)
    } catch (error) {
      mainLog.warn('[BrowserGame] semantic event rejected', error)
    }
  }

  private publishChanged(): void {
    for (const listener of this.listeners) listener()
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private createId(): string {
    return (this.options.createId ?? randomUUID)()
  }
}
