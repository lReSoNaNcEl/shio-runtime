import { z } from 'zod'

import {
  BROWSER_COMPUTER_USE_MAX_ACTIONS,
  BROWSER_COMPUTER_USE_MAX_DURATION_MS,
  BROWSER_COMPUTER_USE_MAX_STEPS,
} from '../browser-computer-use'
import {
  BROWSER_SEMANTIC_RISK_CLASSES,
  type BrowserActionExecution,
  browserActionExecutionSchema,
  browserOperationSchema,
} from '../browser-control'

export const DESKTOP_WORKFLOW_CAPABILITIES = [
  'browser',
  'desktop-ui',
  'filesystem',
  'shell',
] as const
export type DesktopWorkflowCapability = (typeof DESKTOP_WORKFLOW_CAPABILITIES)[number]

export const desktopAuthorityModeSchema = z.enum(['confirm', 'full'])
export type DesktopAuthorityMode = z.infer<typeof desktopAuthorityModeSchema>

export const DESKTOP_WORKFLOW_REPORTED_OUTCOME_MAX_CHARS = 8_000
export const DESKTOP_WORKFLOW_SHELL_OUTPUT_MAX_CHARS = 8_000

const shellCommandSchema = z.string().trim().min(1).max(2_000)
const browserUrlSchema = z
  .string()
  .trim()
  .max(2_048)
  .url()
  .refine((value) => {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    )
  }, 'Browser URL must be an HTTP(S) URL without embedded credentials')

function validateDesktopWorkflowContract(
  value: {
    requestedCapabilities: DesktopWorkflowCapability[]
    shellCommand?: string
    browserUrl?: string
    browserOperation?: z.infer<typeof browserOperationSchema>
  },
  context: z.RefinementCtx,
): void {
  const shellRequested = value.requestedCapabilities.includes('shell')
  if (shellRequested && value.shellCommand === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['shellCommand'],
      message: 'Shell workflows require an exact PowerShell command',
    })
  }
  if (!shellRequested && value.shellCommand !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['shellCommand'],
      message: 'PowerShell commands require the shell capability',
    })
  }
  const browserRequested = value.requestedCapabilities.includes('browser')
  if (!browserRequested && value.browserUrl !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['browserUrl'],
      message: 'Browser URLs require the browser capability',
    })
  }
  if (!browserRequested && value.browserOperation !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['browserOperation'],
      message: 'Browser operations require the browser capability',
    })
  }
  if (value.browserUrl !== undefined && value.browserOperation !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['browserOperation'],
      message: 'Use either the legacy browser URL or one typed browser operation',
    })
  }
}

export const desktopWorkflowRequestSchema = z
  .object({
    type: z.literal('desktop.workflow'),
    goal: z.string().trim().min(1).max(2_000),
    shellCommand: shellCommandSchema.optional(),
    browserUrl: browserUrlSchema.optional(),
    browserOperation: browserOperationSchema.optional(),
    requestedCapabilities: z
      .array(z.enum(DESKTOP_WORKFLOW_CAPABILITIES))
      .min(1)
      .max(DESKTOP_WORKFLOW_CAPABILITIES.length)
      .refine((values) => new Set(values).size === values.length, 'Capabilities must be unique'),
    risk: z.enum(['normal', 'destructive']),
  })
  .strict()
  .superRefine(validateDesktopWorkflowContract)
export type DesktopWorkflowRequest = z.infer<typeof desktopWorkflowRequestSchema>

export const actionIdSchema = z.string().regex(/^action-[0-9]+-[0-9a-f-]{36}$/i)

const desktopActionConfirmationRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    actionId: actionIdSchema,
    tool: z.literal('desktop.workflow'),
    goal: z.string().min(1).max(2_000),
    shellCommand: shellCommandSchema.optional(),
    browserUrl: browserUrlSchema.optional(),
    browserOperation: browserOperationSchema.optional(),
    browserRiskClass: z.enum(BROWSER_SEMANTIC_RISK_CLASSES).optional(),
    requestedCapabilities: z.array(z.enum(DESKTOP_WORKFLOW_CAPABILITIES)).min(1).max(4),
    risk: z.enum(['normal', 'destructive']),
  })
  .strict()
  .superRefine(validateDesktopWorkflowContract)

const browserComputerUseActionConfirmationRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    actionId: actionIdSchema,
    tool: z.literal('browser.use'),
    goal: z.string().min(1).max(1_000),
    maxSteps: z.number().int().min(1).max(BROWSER_COMPUTER_USE_MAX_STEPS),
    maxActions: z.number().int().min(1).max(BROWSER_COMPUTER_USE_MAX_ACTIONS),
    maxDurationMs: z.number().int().min(5_000).max(BROWSER_COMPUTER_USE_MAX_DURATION_MS),
    requestedCapabilities: z.tuple([z.literal('browser-computer-use')]),
    risk: z.literal('normal'),
  })
  .strict()

export const actionConfirmationRequestSchema = z.union([
  desktopActionConfirmationRequestSchema,
  browserComputerUseActionConfirmationRequestSchema,
])
export type ActionConfirmationRequest = z.infer<typeof actionConfirmationRequestSchema>

export const actionConfirmationResponseSchema = z
  .object({
    actionId: actionIdSchema,
    decision: z.enum(['confirm', 'cancel']),
  })
  .strict()
export type ActionConfirmationResponse = z.infer<typeof actionConfirmationResponseSchema>

export const authorityChangeRequestSchema = z
  .object({
    requestId: z.string().regex(/^authority-[0-9]+-[0-9a-f-]{36}$/i),
    requestedMode: z.literal('full'),
  })
  .strict()
export type AuthorityChangeRequest = z.infer<typeof authorityChangeRequestSchema>

export const authorityChangeResponseSchema = z
  .object({
    requestId: authorityChangeRequestSchema.shape.requestId,
    decision: z.enum(['confirm', 'cancel']),
  })
  .strict()
export type AuthorityChangeResponse = z.infer<typeof authorityChangeResponseSchema>

export const actionOutcomeSchema = z.enum([
  'success',
  'failure',
  'permission-denied',
  'timeout',
  'cancelled',
])
export type ActionOutcome = z.infer<typeof actionOutcomeSchema>

export const actionAuthorizationSchema = z.enum(['implicit', 'confirmed', 'full'])
export type ActionAuthorization = z.infer<typeof actionAuthorizationSchema>

export const actionVerificationStatusSchema = z.enum([
  'not-required',
  'verified',
  'unverified',
  'failed',
])
export type ActionVerificationStatus = z.infer<typeof actionVerificationStatusSchema>

export const actionPresentationFactSchema = z
  .object({
    kind: z.literal('runtime-version'),
    label: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(200),
    sensitivity: z.enum(['safe', 'sensitive']),
  })
  .strict()
export type ActionPresentationFact = z.infer<typeof actionPresentationFactSchema>

export const shellActionExecutionSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    stdout: z.string().max(DESKTOP_WORKFLOW_SHELL_OUTPUT_MAX_CHARS),
    stderr: z.string().max(DESKTOP_WORKFLOW_SHELL_OUTPUT_MAX_CHARS),
    truncated: z.boolean(),
  })
  .strict()
export type ShellActionExecution = z.infer<typeof shellActionExecutionSchema>

export interface ActionReplyGrounding {
  actionId: string
  tool: 'desktop.workflow'
  result: {
    outcome: ActionOutcome
    authorization?: ActionAuthorization
    runtimeCompleted?: boolean
    verification?: DesktopWorkflowExecution['verification']
    browser?: BrowserActionExecution
    presentationFacts?: readonly ActionPresentationFact[]
    reportedOutcomeSha256?: string
    reportedOutcomeCharacters?: number
    errorCode?: string
  }
}

export const desktopWorkflowExecutionSchema = z
  .object({
    runtimeCompleted: z.boolean(),
    reportedOutcome: z.string().max(DESKTOP_WORKFLOW_REPORTED_OUTCOME_MAX_CHARS).optional(),
    verification: actionVerificationStatusSchema,
    verificationReason: z.string().max(100).optional(),
    verificationSummary: z.string().max(500).optional(),
    browser: browserActionExecutionSchema.optional(),
    shell: shellActionExecutionSchema.optional(),
    presentationFacts: z.array(actionPresentationFactSchema).max(8).optional(),
  })
  .strict()
export type DesktopWorkflowExecution = z.infer<typeof desktopWorkflowExecutionSchema>

export const desktopWorkflowActionResultSchema = z
  .object({
    actionId: actionIdSchema,
    tool: z.literal('desktop.workflow'),
    outcome: actionOutcomeSchema,
    authorization: actionAuthorizationSchema.optional(),
    execution: desktopWorkflowExecutionSchema.optional(),
    errorCode: z.string().max(100).optional(),
    error: z.string().max(500).optional(),
  })
  .strict()
export type DesktopWorkflowActionResult = z.infer<typeof desktopWorkflowActionResultSchema>

export const actionLogEntrySchema = z
  .object({
    actionId: actionIdSchema,
    tool: z.string().min(1).max(100),
    lifecycle: z.array(
      z.enum([
        'requested',
        'validated',
        'authorized',
        'executed',
        'verification-started',
        'verification-completed',
        'completed',
      ]),
    ),
    requestedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    authorization: actionAuthorizationSchema.optional(),
    outcome: actionOutcomeSchema.optional(),
    executionStatus: z.enum(['success', 'failure', 'timeout', 'cancelled']).optional(),
    verificationStatus: actionVerificationStatusSchema.optional(),
    verificationDurationMs: z.number().int().nonnegative().optional(),
    recoveryAttempted: z.boolean().optional(),
    adapter: z.string().max(100).optional(),
    errorCode: z.string().max(100).optional(),
  })
  .strict()
export type ActionLogEntry = z.infer<typeof actionLogEntrySchema>

export const actionRuntimeSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    authorityMode: desktopAuthorityModeSchema,
    pendingConfirmation: actionConfirmationRequestSchema.nullable(),
    pendingAuthorityChange: authorityChangeRequestSchema.nullable(),
    activeActionId: actionIdSchema.nullable(),
    activeActionPhase: z.enum(['executing', 'verifying', 'recovering']).nullable(),
    recentActions: z.array(actionLogEntrySchema).max(50),
  })
  .strict()
export type ActionRuntimeSnapshot = z.infer<typeof actionRuntimeSnapshotSchema>

export const actionAcknowledgementSchema = z.object({ ok: z.literal(true) }).strict()
export type ActionAcknowledgement = z.infer<typeof actionAcknowledgementSchema>

export const authorityModeChangeResultSchema = z
  .object({
    ok: z.boolean(),
    mode: desktopAuthorityModeSchema,
  })
  .strict()

export interface ShioActionsApi {
  respondToConfirmation(response: ActionConfirmationResponse): Promise<ActionAcknowledgement>
  requestAuthorityMode(mode: DesktopAuthorityMode): Promise<{
    ok: boolean
    mode: DesktopAuthorityMode
  }>
  respondToAuthorityChange(response: AuthorityChangeResponse): Promise<ActionAcknowledgement>
  emergencyStop(): Promise<ActionAcknowledgement>
  snapshot(): Promise<ActionRuntimeSnapshot>
  onConfirmationRequested(callback: (request: ActionConfirmationRequest) => void): () => void
  onAuthorityChangeRequested(callback: (request: AuthorityChangeRequest) => void): () => void
  onChanged(callback: (snapshot: ActionRuntimeSnapshot) => void): () => void
}
