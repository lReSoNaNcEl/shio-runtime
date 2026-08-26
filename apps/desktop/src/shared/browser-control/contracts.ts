import { z } from 'zod'

import {
  browserComputerUseSessionSchema,
  browserVisualControlStateSchema,
} from '../browser-computer-use'

export const PLAYWRIGHT_CORE_VERSION = '1.62.1' as const

export const browserControlStatusSchema = z
  .object({
    enabled: z.boolean(),
    browserName: z.literal('Google Chrome'),
    backend: z.literal('playwright'),
    backendVersion: z.literal(PLAYWRIGHT_CORE_VERSION),
    executableAvailable: z.boolean(),
    isolatedProfile: z.literal(true),
    semanticControl: z.enum(['ready', 'unavailable']),
    visualControl: browserVisualControlStateSchema,
    visualModel: z.string().trim().min(1).max(300),
    session: browserComputerUseSessionSchema.nullable(),
  })
  .strict()
export type BrowserControlStatus = z.infer<typeof browserControlStatusSchema>

export interface BrowserControlApi {
  getStatus(): Promise<BrowserControlStatus>
  pause(): Promise<BrowserControlStatus>
  resume(): Promise<BrowserControlStatus>
  stop(): Promise<BrowserControlStatus>
}

export * from './semantic'
