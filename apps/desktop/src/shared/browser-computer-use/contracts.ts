import { z } from 'zod'

import type { BrowserContextProvider } from '../browser-control'

export const BROWSER_COMPUTER_USE_DEFAULT_MAX_STEPS = 30
export const BROWSER_COMPUTER_USE_DEFAULT_MAX_ACTIONS = 100
export const BROWSER_COMPUTER_USE_DEFAULT_DURATION_MS = 5 * 60 * 1_000
export const BROWSER_COMPUTER_USE_MAX_STEPS = 300
export const BROWSER_COMPUTER_USE_MAX_ACTIONS = 1_000
export const BROWSER_COMPUTER_USE_MAX_DURATION_MS = 30 * 60 * 1_000

export const browserComputerUseStateSchema = z.enum([
  'starting',
  'running',
  'paused',
  'waiting-user',
  'completed',
  'failed',
  'stopped',
])
export type BrowserComputerUseState = z.infer<typeof browserComputerUseStateSchema>

export const browserVisualControlStateSchema = z.enum([
  'ready',
  'needs-setup',
  'rate-limited',
  'unavailable',
])
export type BrowserVisualControlState = z.infer<typeof browserVisualControlStateSchema>

export const browserComputerUseSessionSchema = z
  .object({
    id: z.string().regex(/^browser-use-session-[0-9a-f-]{36}$/iu),
    goal: z.string().trim().min(1).max(2_000),
    browserContextId: z.string().min(1).max(200),
    pageId: z.string().min(1).max(200),
    state: browserComputerUseStateSchema,
    startedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    maxSteps: z.number().int().min(1).max(BROWSER_COMPUTER_USE_MAX_STEPS),
    maxActions: z.number().int().min(1).max(BROWSER_COMPUTER_USE_MAX_ACTIONS),
    stepCount: z.number().int().nonnegative(),
    actionCount: z.number().int().nonnegative(),
    authorityScopeId: z.string().min(1).max(200),
    mode: z.enum(['semantic', 'visual', 'realtime']),
    activity: z.enum([
      'starting',
      'observing',
      'deciding',
      'acting',
      'verifying',
      'waiting-user',
      'idle',
    ]),
    summary: z.string().max(500).optional(),
    lastErrorCode: z.string().max(100).optional(),
  })
  .strict()
export type BrowserComputerUseSession = z.infer<typeof browserComputerUseSessionSchema>

export const browserComputerUseStartRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(2_000),
    maxSteps: z
      .number()
      .int()
      .min(1)
      .max(BROWSER_COMPUTER_USE_MAX_STEPS)
      .default(BROWSER_COMPUTER_USE_DEFAULT_MAX_STEPS),
    maxActions: z
      .number()
      .int()
      .min(1)
      .max(BROWSER_COMPUTER_USE_MAX_ACTIONS)
      .default(BROWSER_COMPUTER_USE_DEFAULT_MAX_ACTIONS),
    maxDurationMs: z
      .number()
      .int()
      .min(10_000)
      .max(BROWSER_COMPUTER_USE_MAX_DURATION_MS)
      .default(BROWSER_COMPUTER_USE_DEFAULT_DURATION_MS),
  })
  .strict()
export type BrowserComputerUseStartRequest = z.infer<typeof browserComputerUseStartRequestSchema>

export const browserComputerUseControlActionSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('pause') }).strict(),
  z.object({ operation: z.literal('resume') }).strict(),
  z.object({ operation: z.literal('stop') }).strict(),
])
export type BrowserComputerUseControlAction = z.infer<typeof browserComputerUseControlActionSchema>

export const browserComputerUseBlockerSchema = z.enum([
  'captcha',
  'two-factor',
  'authentication',
  'password-manager',
  'payment-confirmation',
  'secure-desktop',
])
export type BrowserComputerUseBlocker = z.infer<typeof browserComputerUseBlockerSchema>

export const browserComputerUseObservationSchema = z
  .object({
    id: z.string().regex(/^browser-use-observation-[0-9a-f-]{36}$/iu),
    page: z
      .object({
        id: z.string().min(1).max(200),
        url: z.string().url().max(2_048),
        title: z.string().max(1_000),
      })
      .strict(),
    viewport: z
      .object({
        width: z.number().int().min(1).max(32_768),
        height: z.number().int().min(1).max(32_768),
      })
      .strict(),
    semantic: z
      .object({
        ariaSnapshot: z.string().max(16_000),
        interactiveCount: z.number().int().nonnegative().max(500),
      })
      .strict()
      .optional(),
    visual: z
      .object({
        mimeType: z.literal('image/jpeg'),
        bytes: z.instanceof(Uint8Array),
      })
      .strict()
      .optional(),
    blocker: browserComputerUseBlockerSchema.optional(),
    capturedAt: z.number().int().nonnegative(),
  })
  .strict()
export type BrowserComputerUseObservation = z.infer<typeof browserComputerUseObservationSchema>

const pointSchema = z.object({ x: z.number(), y: z.number() }).strict()
const decisionScope = {
  observationId: browserComputerUseObservationSchema.shape.id,
  pageId: browserComputerUseObservationSchema.shape.page.shape.id,
}

export const browserComputerUseDecisionSchema = z.discriminatedUnion('type', [
  z
    .object({ ...decisionScope, type: z.literal('click-ref'), ref: z.string().regex(/^e\d+$/u) })
    .strict(),
  z
    .object({
      ...decisionScope,
      type: z.literal('click'),
      x: z.number(),
      y: z.number(),
      button: z.enum(['left', 'right']).default('left'),
    })
    .strict(),
  z.object({ ...decisionScope, type: z.literal('move'), x: z.number(), y: z.number() }).strict(),
  z
    .object({ ...decisionScope, type: z.literal('drag'), from: pointSchema, to: pointSchema })
    .strict(),
  z
    .object({
      ...decisionScope,
      type: z.literal('mouse-down'),
      button: z.enum(['left', 'right']),
      x: z.number(),
      y: z.number(),
    })
    .strict(),
  z
    .object({
      ...decisionScope,
      type: z.literal('mouse-up'),
      button: z.enum(['left', 'right']),
      x: z.number(),
      y: z.number(),
    })
    .strict(),
  z
    .object({ ...decisionScope, type: z.literal('scroll'), dx: z.number(), dy: z.number() })
    .strict(),
  z
    .object({
      ...decisionScope,
      type: z.literal('fill-ref'),
      ref: z.string().regex(/^e\d+$/u),
      text: z.string().max(2_000),
    })
    .strict(),
  z.object({ ...decisionScope, type: z.literal('key'), key: z.string().min(1).max(100) }).strict(),
  z
    .object({ ...decisionScope, type: z.literal('key-down'), key: z.string().min(1).max(100) })
    .strict(),
  z
    .object({ ...decisionScope, type: z.literal('key-up'), key: z.string().min(1).max(100) })
    .strict(),
  z.object({ ...decisionScope, type: z.literal('type'), text: z.string().max(2_000) }).strict(),
  z
    .object({ ...decisionScope, type: z.literal('navigate'), url: z.string().url().max(2_048) })
    .strict(),
  z.object({ ...decisionScope, type: z.literal('back') }).strict(),
  z.object({ ...decisionScope, type: z.literal('forward') }).strict(),
  z
    .object({
      ...decisionScope,
      type: z.literal('switch-tab'),
      targetPageId: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      ...decisionScope,
      type: z.literal('wait'),
      durationMs: z.number().int().min(50).max(5_000),
    })
    .strict(),
  z
    .object({
      ...decisionScope,
      type: z.literal('request-user'),
      reasonCode: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      ...decisionScope,
      type: z.literal('done'),
      summary: z.string().trim().min(1).max(500),
    })
    .strict(),
])
export type BrowserComputerUseDecision = z.infer<typeof browserComputerUseDecisionSchema>

export const computerUseNotableObservationSchema = z
  .object({
    kind: z.enum(['progress', 'success', 'failure', 'blocked', 'surprise']),
    summary: z.string().trim().min(1).max(300),
    confidence: z.number().min(0).max(1),
  })
  .strict()
export type ComputerUseNotableObservation = z.infer<typeof computerUseNotableObservationSchema>

export interface BrowserComputerUseStatus {
  enabled: boolean
  browser: 'Google Chrome'
  isolatedProfile: true
  semanticControl: 'ready' | 'unavailable'
  visualControl: BrowserVisualControlState
  visualModel: string
  currentSession: BrowserComputerUseSession | null
}

export interface BrowserComputerUseProvider {
  readonly browserContext: BrowserContextProvider
  status(): BrowserComputerUseStatus
  start(
    request: BrowserComputerUseStartRequest,
    authorityScopeId: string,
    signal: AbortSignal,
  ): Promise<BrowserComputerUseSession>
  pause(): Promise<BrowserComputerUseSession>
  resume(signal: AbortSignal): Promise<BrowserComputerUseSession>
  stop(): Promise<BrowserComputerUseSession>
}
