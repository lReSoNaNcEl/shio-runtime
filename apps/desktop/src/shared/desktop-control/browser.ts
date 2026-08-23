import { z } from 'zod'

export const BROWSER_OBSERVATION_CONTENT_MAX_CHARS = 12_000
export const BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS = 200

export const browserInteractiveRoleSchema = z.enum([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'tab',
  'menuitem',
  'other',
])
export type BrowserInteractiveRole = z.infer<typeof browserInteractiveRoleSchema>

export const browserInteractiveElementSchema = z
  .object({
    ref: z.string().regex(/^e\d+$/u),
    role: browserInteractiveRoleSchema,
    name: z.string().max(500).optional(),
    disabled: z.boolean().optional(),
  })
  .strict()
export type BrowserInteractiveElement = z.infer<typeof browserInteractiveElementSchema>

export const browserSessionStateSchema = z
  .object({
    sessionId: z.string().regex(/^browser-session-[0-9a-f-]{36}$/iu),
    status: z.enum(['starting', 'ready', 'closed', 'error']),
    currentUrl: z.string().url().max(2_048).optional(),
    currentTitle: z.string().max(1_000).optional(),
    activeTabId: z.string().max(200).optional(),
    openedAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
export type BrowserSessionState = z.infer<typeof browserSessionStateSchema>

export const browserObservationSchema = z
  .object({
    observationId: z.string().regex(/^browser-observation-[0-9a-f-]{36}$/iu),
    sessionId: browserSessionStateSchema.shape.sessionId,
    url: z.string().url().max(2_048),
    title: z.string().max(1_000).optional(),
    capturedAt: z.number().int().nonnegative(),
    content: z.string().max(BROWSER_OBSERVATION_CONTENT_MAX_CHARS),
    interactiveElements: z
      .array(browserInteractiveElementSchema)
      .max(BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS),
    truncated: z.boolean(),
  })
  .strict()
export type BrowserObservation = z.infer<typeof browserObservationSchema>

export const browserTabSchema = z
  .object({
    tabId: z.string().min(1).max(200),
    url: z.string().url().max(2_048).optional(),
    title: z.string().max(1_000).optional(),
    active: z.boolean(),
  })
  .strict()
export type BrowserTab = z.infer<typeof browserTabSchema>

export const browserTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('semantic-ref'),
      observationId: browserObservationSchema.shape.observationId,
      ref: browserInteractiveElementSchema.shape.ref,
    })
    .strict(),
  z
    .object({
      kind: z.literal('accessible-name'),
      observationId: browserObservationSchema.shape.observationId,
      role: browserInteractiveRoleSchema,
      name: z.string().trim().min(1).max(500),
    })
    .strict(),
])
export type BrowserTarget = z.infer<typeof browserTargetSchema>

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

export const browserOperationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('open'), url: browserUrlSchema }).strict(),
  z.object({ operation: z.literal('click'), target: browserTargetSchema }).strict(),
  z
    .object({ operation: z.literal('switch-tab'), tabId: z.string().trim().min(1).max(200) })
    .strict(),
])
export type BrowserOperation = z.infer<typeof browserOperationSchema>

export const browserActionExecutionSchema = z
  .object({
    kind: z.literal('browser'),
    operation: z.enum(['open', 'click', 'switch-tab']),
    status: z.enum(['success', 'failed', 'cancelled']),
    verification: z.enum(['verified', 'unverified']).optional(),
    resultingUrl: z.string().url().max(2_048).optional(),
    resultingTitle: z.string().max(1_000).optional(),
    targetName: z.string().max(500).optional(),
  })
  .strict()
export type BrowserActionExecution = z.infer<typeof browserActionExecutionSchema>

export type BrowserContextRequirement = 'none' | 'current-page'

export interface BrowserContextRequest {
  userText: string
  traceId: string
}

/** Read-only, request-scoped access to the current Plugin-owned browser session. */
export interface BrowserContextProvider {
  resolveRequirement(request: BrowserContextRequest): BrowserContextRequirement
  buildContext(request: BrowserContextRequest): Promise<BrowserObservation | null>
}

export type BrowserContextProviderResolver = () => BrowserContextProvider | undefined
