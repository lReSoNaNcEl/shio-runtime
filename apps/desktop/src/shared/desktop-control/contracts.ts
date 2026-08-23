import { z } from 'zod'

import type { DesktopAuthorityMode, DesktopWorkflowExecution } from '../actions'
import { LLM_PROVIDER_IDS } from '../llm'

export const DSH_RUNTIME_VERSION = '0.1.1-rc.2' as const
export const AGENT_BROWSER_VERSION = '0.34.0' as const

export const desktopControlRuntimeStateSchema = z.enum([
  'stopped',
  'starting',
  'ready',
  'running',
  'stopping',
  'error',
])
export type DesktopControlRuntimeState = z.infer<typeof desktopControlRuntimeStateSchema>

export const desktopControlCapabilityStateSchema = z.enum(['ready', 'needs-setup', 'unavailable'])
export type DesktopControlCapabilityState = z.infer<typeof desktopControlCapabilityStateSchema>

export const desktopControlStatusSchema = z
  .object({
    enabled: z.boolean(),
    runtime: z.object({
      state: desktopControlRuntimeStateSchema,
      packagedRuntimeAvailable: z.boolean(),
      version: z.literal(DSH_RUNTIME_VERSION),
      startedAt: z.number().int().nonnegative().optional(),
      lastError: z.string().max(500).optional(),
    }),
    automationEngine: desktopControlCapabilityStateSchema,
    browserControl: desktopControlCapabilityStateSchema,
    computerControl: desktopControlCapabilityStateSchema,
    browser: z
      .object({
        version: z.literal(AGENT_BROWSER_VERSION),
        packagedBinaryAvailable: z.boolean(),
        executableAvailable: z.boolean(),
        isolatedProfile: z.literal(true),
      })
      .strict(),
    shell: z
      .object({
        executableAvailable: z.boolean(),
      })
      .strict(),
    authorityMode: z.enum(['confirm', 'full']),
    model: z.object({
      provider: z.enum(LLM_PROVIDER_IDS),
      providerDisplayName: z.string().trim().min(1).max(100),
      model: z.string().max(500),
      configured: z.boolean(),
      lastError: z.string().max(500).optional(),
    }),
  })
  .strict()
export type DesktopControlStatus = z.infer<typeof desktopControlStatusSchema>

export interface DesktopControlApi {
  getStatus(): Promise<DesktopControlStatus>
  startRuntime(): Promise<DesktopControlStatus>
  stopRuntime(): Promise<DesktopControlStatus>
}

export interface DesktopAutomationAdapter {
  execute(goal: string, options: { signal: AbortSignal }): Promise<DesktopWorkflowExecution>
  close(): Promise<void>
}

export interface DesktopControlCapabilityProjection {
  enabled: boolean
  automationEngine: DesktopControlCapabilityState
  browserControl: DesktopControlCapabilityState
  computerControl: DesktopControlCapabilityState
  authorityMode: DesktopAuthorityMode
}
