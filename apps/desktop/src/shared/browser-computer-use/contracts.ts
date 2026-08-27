import { z } from 'zod'

import type { BrowserContextProvider } from '../browser-control'

export const BROWSER_COMPUTER_USE_DEFAULT_MAX_STEPS = 30
export const BROWSER_COMPUTER_USE_DEFAULT_MAX_ACTIONS = 100
export const BROWSER_COMPUTER_USE_DEFAULT_DURATION_MS = 5 * 60 * 1_000
export const BROWSER_COMPUTER_USE_MAX_STEPS = 300
export const BROWSER_COMPUTER_USE_MAX_ACTIONS = 1_000
export const BROWSER_COMPUTER_USE_MAX_DURATION_MS = 30 * 60 * 1_000
export const BROWSER_COMPUTER_USE_CONTINUOUS_DEFAULT_LEASE_MS = 30 * 60 * 1_000
export const BROWSER_COMPUTER_USE_CONTINUOUS_MAX_LEASE_MS = 2 * 60 * 60 * 1_000

export const browserComputerUseTerminationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goal-completed') }).strict(),
  z.object({ type: z.literal('until-stopped') }).strict(),
  z
    .object({
      type: z.literal('until-time'),
      durationMs: z.number().int().min(10_000).max(BROWSER_COMPUTER_USE_CONTINUOUS_MAX_LEASE_MS),
    })
    .strict(),
])
export type BrowserComputerUseTermination = z.infer<typeof browserComputerUseTerminationSchema>

export const continuousControlBudgetSchema = z
  .object({
    maximumDurationMs: z
      .number()
      .int()
      .min(10_000)
      .max(BROWSER_COMPUTER_USE_CONTINUOUS_MAX_LEASE_MS),
    maxSlowDecisionsPerMinute: z.number().int().min(1).max(120),
    maxReactiveInputEventsPerSecond: z.number().int().min(1).max(60),
    maxReactiveInputEventsTotal: z.number().int().min(1).max(500_000),
    maxPointerHoldMs: z.number().int().min(50).max(10_000),
    maxKeyHoldMs: z.number().int().min(50).max(10_000),
    maxFrameRate: z.number().int().min(1).max(30),
  })
  .strict()
export type ContinuousControlBudget = z.infer<typeof continuousControlBudgetSchema>

export const DEFAULT_CONTINUOUS_CONTROL_BUDGET: ContinuousControlBudget = Object.freeze({
  maximumDurationMs: BROWSER_COMPUTER_USE_CONTINUOUS_DEFAULT_LEASE_MS,
  maxSlowDecisionsPerMinute: 120,
  maxReactiveInputEventsPerSecond: 30,
  maxReactiveInputEventsTotal: 216_000,
  maxPointerHoldMs: 5_000,
  maxKeyHoldMs: 5_000,
  maxFrameRate: 30,
})

export const browserComputerUseStateSchema = z.enum([
  'running',
  'stopping',
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

export const browserComputerUseDiagnosticsSchema = z
  .object({
    captureFps: z.number().finite().nonnegative(),
    framesReceived: z.number().int().nonnegative(),
    framesProcessed: z.number().int().nonnegative(),
    framesDropped: z.number().int().nonnegative(),
    maxPendingFrames: z.number().int().min(0).max(1),
    trackingConfidence: z.number().min(0).max(1),
    fastInputHz: z.number().finite().nonnegative(),
    inputEventsTotal: z.number().int().nonnegative(),
    vlmLatencyP50Ms: z.number().finite().nonnegative(),
    vlmLatencyP95Ms: z.number().finite().nonnegative(),
    trackingLatencyP50Ms: z.number().finite().nonnegative(),
    trackingLatencyP95Ms: z.number().finite().nonnegative(),
    frameToInputP50Ms: z.number().finite().nonnegative(),
    frameToInputP95Ms: z.number().finite().nonnegative(),
    planAgeMs: z.number().finite().nonnegative(),
    planReplacements: z.number().int().nonnegative(),
    planExpirations: z.number().int().nonnegative(),
    reanchors: z.number().int().nonnegative(),
    modeTransitions: z.number().int().nonnegative(),
    activeScreencast: z.boolean(),
    activeVlmRequests: z.number().int().min(0).max(1),
    vlmRequestsTotal: z.number().int().nonnegative(),
    activeCdpSessions: z.number().int().min(0).max(2),
    heldKeys: z.number().int().nonnegative(),
    heldButtons: z.number().int().nonnegative(),
    workerActive: z.boolean(),
    workerMemoryBytes: z.number().int().nonnegative(),
    pendingFrames: z.number().int().min(0).max(1),
  })
  .strict()
export type BrowserComputerUseDiagnostics = z.infer<typeof browserComputerUseDiagnosticsSchema>

export const EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS: BrowserComputerUseDiagnostics = Object.freeze({
  captureFps: 0,
  framesReceived: 0,
  framesProcessed: 0,
  framesDropped: 0,
  maxPendingFrames: 0,
  trackingConfidence: 0,
  fastInputHz: 0,
  inputEventsTotal: 0,
  vlmLatencyP50Ms: 0,
  vlmLatencyP95Ms: 0,
  trackingLatencyP50Ms: 0,
  trackingLatencyP95Ms: 0,
  frameToInputP50Ms: 0,
  frameToInputP95Ms: 0,
  planAgeMs: 0,
  planReplacements: 0,
  planExpirations: 0,
  reanchors: 0,
  modeTransitions: 0,
  activeScreencast: false,
  activeVlmRequests: 0,
  vlmRequestsTotal: 0,
  activeCdpSessions: 0,
  heldKeys: 0,
  heldButtons: 0,
  workerActive: false,
  workerMemoryBytes: 0,
  pendingFrames: 0,
})

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
    termination: browserComputerUseTerminationSchema,
    continuousBudget: continuousControlBudgetSchema.optional(),
    mode: z.enum(['semantic', 'visual']),
    controlMode: z.enum(['slow', 'reactive']),
    activity: z.enum([
      'starting',
      'observing',
      'deciding',
      'acting',
      'verifying',
      'tracking',
      'reacting',
      'reanchoring',
      'waiting-user',
      'idle',
    ]),
    diagnostics: browserComputerUseDiagnosticsSchema,
    summary: z.string().max(500).optional(),
    lastErrorCode: z.string().max(100).optional(),
  })
  .strict()
export type BrowserComputerUseSession = z.infer<typeof browserComputerUseSessionSchema>

export const browserComputerUseStartRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(2_000),
    termination: browserComputerUseTerminationSchema.optional(),
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
    visualFingerprint: z.string().regex(/^[0-9a-f]{60}$/u),
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
const visualDecisionScope = {
  ...decisionScope,
  visualFingerprint: browserComputerUseObservationSchema.shape.visualFingerprint,
}

export const browserComputerUseDecisionSchema = z.discriminatedUnion('type', [
  z
    .object({ ...decisionScope, type: z.literal('click-ref'), ref: z.string().regex(/^e\d+$/u) })
    .strict(),
  z
    .object({
      ...visualDecisionScope,
      type: z.literal('click'),
      x: z.number(),
      y: z.number(),
      button: z.enum(['left', 'right']).default('left'),
    })
    .strict(),
  z
    .object({ ...visualDecisionScope, type: z.literal('move'), x: z.number(), y: z.number() })
    .strict(),
  z
    .object({ ...visualDecisionScope, type: z.literal('drag'), from: pointSchema, to: pointSchema })
    .strict(),
  z
    .object({
      ...visualDecisionScope,
      type: z.literal('mouse-down'),
      button: z.enum(['left', 'right']),
      x: z.number(),
      y: z.number(),
    })
    .strict(),
  z
    .object({
      ...visualDecisionScope,
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

export const browserCompletionAssessmentSchema = z
  .object({
    status: z.enum(['satisfied', 'not-satisfied', 'uncertain']),
    confidence: z.number().min(0).max(1),
    evidenceSummary: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
export type BrowserCompletionAssessment = z.infer<typeof browserCompletionAssessmentSchema>

export const computerUseNotableObservationSchema = z
  .object({
    kind: z.enum(['progress', 'success', 'failure', 'blocked', 'surprise']),
    summary: z.string().trim().min(1).max(300),
    confidence: z.number().min(0).max(1),
  })
  .strict()
export type ComputerUseNotableObservation = z.infer<typeof computerUseNotableObservationSchema>

export const browserReactiveAnchorSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
    role: z.enum(['controlled', 'target', 'hazard', 'reference']),
    bounds: z
      .object({
        x: z.number().finite().min(0).max(32_768),
        y: z.number().finite().min(0).max(32_768),
        width: z.number().finite().min(1).max(32_768),
        height: z.number().finite().min(1).max(32_768),
      })
      .strict(),
  })
  .strict()
export type BrowserReactiveAnchor = z.infer<typeof browserReactiveAnchorSchema>

const directionalKeySchema = z.enum([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'w',
  'a',
  's',
  'd',
])

export const browserReactiveControlPrimitiveSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('pointer-follow'),
      targetAnchorId: browserReactiveAnchorSchema.shape.id,
    })
    .strict(),
  z
    .object({
      type: z.literal('pointer-steer'),
      controlledAnchorId: browserReactiveAnchorSchema.shape.id,
      targetAnchorId: browserReactiveAnchorSchema.shape.id,
      sensitivity: z.number().finite().min(0.1).max(4).default(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('directional-keys'),
      controlledAnchorId: browserReactiveAnchorSchema.shape.id,
      targetAnchorId: browserReactiveAnchorSchema.shape.id,
      keys: z
        .object({
          up: directionalKeySchema,
          down: directionalKeySchema,
          left: directionalKeySchema,
          right: directionalKeySchema,
        })
        .strict(),
      deadZonePx: z.number().finite().min(1).max(500).default(12),
    })
    .strict(),
  z
    .object({
      type: z.literal('tap-target'),
      targetAnchorId: browserReactiveAnchorSchema.shape.id,
      button: z.enum(['left', 'right']).default('left'),
    })
    .strict(),
  z
    .object({
      type: z.literal('pointer-hold'),
      targetAnchorId: browserReactiveAnchorSchema.shape.id,
      button: z.enum(['left', 'right']).default('left'),
      holdMs: z.number().int().min(50).max(5_000),
    })
    .strict(),
])
export type BrowserReactiveControlPrimitive = z.infer<typeof browserReactiveControlPrimitiveSchema>

export const browserReactiveControlPlanSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    sessionId: browserComputerUseSessionSchema.shape.id,
    pageId: browserComputerUseObservationSchema.shape.page.shape.id,
    sourceObservationId: browserComputerUseObservationSchema.shape.id,
    sourceVisualFingerprint: browserComputerUseObservationSchema.shape.visualFingerprint,
    confidence: z.number().min(0).max(1),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    reanchorAfterMs: z.number().int().min(250).max(5_000),
    maximumInputHz: z.number().int().min(1).max(60),
    anchors: z.array(browserReactiveAnchorSchema).min(1).max(16),
    primitive: browserReactiveControlPrimitiveSchema,
    notableObservation: computerUseNotableObservationSchema.optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.expiresAt <= plan.createdAt || plan.expiresAt - plan.createdAt > 5_000) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Reactive plan TTL must be positive and no longer than 5 seconds',
      })
    }
    const ids = new Set(plan.anchors.map((anchor) => anchor.id))
    if (ids.size !== plan.anchors.length) {
      context.addIssue({
        code: 'custom',
        path: ['anchors'],
        message: 'Reactive anchor ids must be unique',
      })
    }
    const referenced =
      plan.primitive.type === 'pointer-follow' ||
      plan.primitive.type === 'tap-target' ||
      plan.primitive.type === 'pointer-hold'
        ? [plan.primitive.targetAnchorId]
        : [plan.primitive.controlledAnchorId, plan.primitive.targetAnchorId]
    for (const id of referenced) {
      if (!ids.has(id)) {
        context.addIssue({
          code: 'custom',
          path: ['primitive'],
          message: `Reactive primitive references unknown anchor ${id}`,
        })
      }
    }
  })
export type BrowserReactiveControlPlan = z.infer<typeof browserReactiveControlPlanSchema>

export interface BrowserReactivePlanningContext {
  goal: string
  sessionId: string
  termination: BrowserComputerUseTermination
  observation: BrowserComputerUseObservation
  previousPlan?: BrowserReactiveControlPlan
}

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
