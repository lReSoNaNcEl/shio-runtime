import { z } from 'zod'

import type { BrowserGameSurfaceCandidate } from '../desktop-control'

export const GAME_SESSION_DEFAULT_DURATION_MS = 5 * 60 * 1_000
export const GAME_SESSION_MAX_DURATION_MS = 30 * 60 * 1_000
export const GAME_SESSION_DEFAULT_MAX_INPUT_EVENTS = 5_000
export const GAME_SESSION_DEFAULT_MAX_INPUT_EVENTS_PER_SECOND = 15
export const GAME_FRAME_MAX_AGE_MS = 500

export const GAME_SEMANTIC_EVENT_TYPES = [
  'game-started',
  'round-started',
  'score-changed',
  'checkpoint',
  'level-completed',
  'life-lost',
  'death',
  'retry',
  'stuck',
  'game-over',
  'new-record',
  'game-paused',
  'game-resumed',
  'game-stopped',
  'game-error',
  'waiting-user',
] as const

export const gameSemanticEventTypeSchema = z.enum(GAME_SEMANTIC_EVENT_TYPES)
export type GameSemanticEventType = z.infer<typeof gameSemanticEventTypeSchema>

export const gameSemanticEventSchema = z
  .object({
    eventId: z.string().regex(/^game-event-[0-9a-f-]{36}$/iu),
    sessionId: z.string().regex(/^game-session-[0-9a-f-]{36}$/iu),
    type: gameSemanticEventTypeSchema,
    at: z.number().int().nonnegative(),
    importance: z.enum(['ambient', 'normal', 'important', 'blocking']),
    value: z.number().finite().min(-1_000_000_000).max(1_000_000_000).optional(),
    previousValue: z.number().finite().min(-1_000_000_000).max(1_000_000_000).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    reason: z
      .enum(['user', 'expired', 'scope-changed', 'blocked', 'error', 'completed'])
      .optional(),
  })
  .strict()
export type GameSemanticEvent = z.infer<typeof gameSemanticEventSchema>

export type BrowserGameErrorCode =
  | 'GAME_CAPABILITY_UNAVAILABLE'
  | 'GAME_SESSION_ACTIVE'
  | 'GAME_SESSION_NOT_RUNNING'
  | 'GAME_SURFACE_NOT_FOUND'
  | 'GAME_SURFACE_SELECTION_REQUIRED'
  | 'GAME_PREPARATION_EXPIRED'
  | 'GAME_SCOPE_CHANGED'
  | 'GAME_SCOPE_EXHAUSTED'
  | 'GAME_INPUT_REJECTED'
  | 'GAME_LOOP_FAILED'

export class BrowserGameError extends Error {
  readonly evidence: unknown

  constructor(
    readonly code: BrowserGameErrorCode,
    readonly details?: unknown,
  ) {
    super(code)
    this.name = 'BrowserGameError'
    this.evidence = details
  }
}

export const gameAllowedInputSchema = z.enum(['pointer', 'keyboard'])
export type GameAllowedInput = z.infer<typeof gameAllowedInputSchema>

export const gameStrategySchema = z.enum(['careful', 'balanced', 'fast'])
export type GameStrategy = z.infer<typeof gameStrategySchema>

export const gameNavigationPolicySchema = z.enum(['same-origin-only', 'none'])
export type GameNavigationPolicy = z.infer<typeof gameNavigationPolicySchema>

export const characterGameStartRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(500),
    surfaceId: z
      .string()
      .regex(/^game-surface-[0-7]$/u)
      .optional(),
    allowedInputs: z
      .array(gameAllowedInputSchema)
      .min(1)
      .max(2)
      .refine((values) => new Set(values).size === values.length, 'Inputs must be unique')
      .default(['pointer', 'keyboard']),
    maxDurationMs: z
      .number()
      .int()
      .min(30_000)
      .max(GAME_SESSION_MAX_DURATION_MS)
      .default(GAME_SESSION_DEFAULT_DURATION_MS),
    maxInputEvents: z
      .number()
      .int()
      .min(1)
      .max(20_000)
      .default(GAME_SESSION_DEFAULT_MAX_INPUT_EVENTS),
    maxInputEventsPerSecond: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(GAME_SESSION_DEFAULT_MAX_INPUT_EVENTS_PER_SECOND),
    navigation: gameNavigationPolicySchema.default('same-origin-only'),
    strategy: gameStrategySchema.default('balanced'),
  })
  .strict()
export type CharacterGameStartRequest = z.infer<typeof characterGameStartRequestSchema>

export interface GameStartPreparation {
  preparationId: string
  goal: string
  browserSessionId: string
  tabId: string
  origin: string
  url: string
  surface: BrowserGameSurfaceCandidate
  allowedInputs: readonly GameAllowedInput[]
  maxDurationMs: number
  maxInputEvents: number
  maxInputEventsPerSecond: number
  navigation: GameNavigationPolicy
  strategy: GameStrategy
  createdAt: number
  expiresAt: number
}

export interface GameSessionScope {
  sessionId: string
  authorizationActionId: string
  browserSessionId: string
  tabId: string
  origin: string
  url: string
  gameSurface: BrowserGameSurfaceCandidate
  allowedInputs: readonly GameAllowedInput[]
  maxDurationMs: number
  maxInputEvents: number
  maxInputEventsPerSecond: number
  navigation: GameNavigationPolicy
  startedAt: number
  expiresAt: number
}

export type GameSessionState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'waiting-user'
  | 'stopping'
  | 'stopped'
  | 'error'

export interface GameSessionTelemetry {
  capturedFrames: number
  droppedFrames: number
  staleDecisions: number
  inputEvents: number
  captureLatencyMsP50?: number
  decisionLatencyMsP50?: number
  inputLatencyMsP50?: number
  startedAt?: number
  stoppedAt?: number
}

export interface BrowserGameStatus {
  state: GameSessionState
  scope?: GameSessionScope
  strategy: GameStrategy
  telemetry: GameSessionTelemetry
  lastErrorCode?: string
}

export interface GameFrame {
  sessionId: string
  frameId: number
  capturedAt: number
  width: number
  height: number
  image: {
    mimeType: 'image/jpeg' | 'image/png'
    bytes: Uint8Array
  }
}

export type GameInputIntent =
  | { type: 'none' }
  | { type: 'pointer-tap'; x: number; y: number }
  | { type: 'pointer-down'; x: number; y: number }
  | { type: 'pointer-up'; x: number; y: number }
  | { type: 'key-tap'; key: string }
  | { type: 'key-down'; key: string }
  | { type: 'key-up'; key: string }

export interface BrowserGameControlProvider {
  discoverSurfaces(signal: AbortSignal): Promise<readonly BrowserGameSurfaceCandidate[]>
  prepareStart(
    request: CharacterGameStartRequest,
    signal: AbortSignal,
  ): Promise<GameStartPreparation>
  start(
    preparationId: string,
    authorizationActionId: string,
    signal: AbortSignal,
  ): Promise<BrowserGameStatus>
  pause(): Promise<BrowserGameStatus>
  resume(): Promise<BrowserGameStatus>
  stop(): Promise<BrowserGameStatus>
  updateStrategy(strategy: GameStrategy): BrowserGameStatus
  status(): BrowserGameStatus
}

export const browserGameControlActionSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('start'),
      preparationId: z.string().regex(/^game-preparation-[0-9a-f-]{36}$/iu),
    })
    .strict(),
  z.object({ operation: z.literal('pause') }).strict(),
  z.object({ operation: z.literal('resume'), strategy: gameStrategySchema.optional() }).strict(),
  z.object({ operation: z.literal('stop') }).strict(),
  z.object({ operation: z.literal('strategy'), strategy: gameStrategySchema }).strict(),
])
export type BrowserGameControlAction = z.infer<typeof browserGameControlActionSchema>

export interface BrowserGameActionResult {
  outcome: 'success' | 'failure' | 'permission-denied' | 'timeout' | 'cancelled'
  authorization?: 'implicit' | 'confirmed' | 'full'
  status?: BrowserGameStatus
  errorCode?: string
}

export type BrowserGameControlProviderResolver = () => BrowserGameControlProvider | undefined
