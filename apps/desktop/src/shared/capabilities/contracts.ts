import { z } from 'zod'

import type { TranslationKey } from '../localization'

export const SHIO_CAPABILITY_SNAPSHOT_SCHEMA_VERSION = 1 as const

export type CapabilityAvailability =
  | 'available'
  | 'disabled'
  | 'needs-setup'
  | 'degraded'
  | 'unavailable'

export type CapabilityCategory =
  | 'communication'
  | 'perception'
  | 'knowledge'
  | 'action'
  | 'presence'

export type CapabilityAuthority = 'read-only' | 'confirm' | 'full'

export interface CapabilityNavigationTarget {
  kind: 'settings' | 'plugin' | 'view'
  id: string
}

export interface ShioCapabilityDescriptor {
  id: string
  category: CapabilityCategory
  source:
    | { kind: 'core' }
    | {
        kind: 'plugin'
        pluginId: string
      }
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  availability: CapabilityAvailability
  authority?: CapabilityAuthority
  navigationTarget?: CapabilityNavigationTarget
  reasonKey?: TranslationKey
}

export interface ShioCapabilitySnapshot {
  schemaVersion: typeof SHIO_CAPABILITY_SNAPSHOT_SCHEMA_VERSION
  generatedAt: number
  capabilities: readonly ShioCapabilityDescriptor[]
}

export interface ShioCapabilityProvider {
  snapshot(): Promise<ShioCapabilitySnapshot>
}

export interface ShioCapabilitiesApi {
  snapshot(): Promise<ShioCapabilitySnapshot>
  onChanged(callback: (snapshot: ShioCapabilitySnapshot) => void): () => void
}

const translationKeySchema = z.string().trim().min(1).max(160)

export const shioCapabilityDescriptorSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    category: z.enum(['communication', 'perception', 'knowledge', 'action', 'presence']),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('core') }).strict(),
      z
        .object({
          kind: z.literal('plugin'),
          pluginId: z.string().trim().min(1).max(100),
        })
        .strict(),
    ]),
    titleKey: translationKeySchema,
    descriptionKey: translationKeySchema,
    availability: z.enum(['available', 'disabled', 'needs-setup', 'degraded', 'unavailable']),
    authority: z.enum(['read-only', 'confirm', 'full']).optional(),
    navigationTarget: z
      .object({
        kind: z.enum(['settings', 'plugin', 'view']),
        id: z.string().trim().min(1).max(100),
      })
      .strict()
      .optional(),
    reasonKey: translationKeySchema.optional(),
  })
  .strict()

export const shioCapabilitySnapshotSchema = z
  .object({
    schemaVersion: z.literal(SHIO_CAPABILITY_SNAPSHOT_SCHEMA_VERSION),
    generatedAt: z.number().int().nonnegative(),
    capabilities: z.array(shioCapabilityDescriptorSchema).max(64),
  })
  .strict()

export function parseShioCapabilitySnapshot(value: unknown): ShioCapabilitySnapshot {
  return shioCapabilitySnapshotSchema.parse(value) as ShioCapabilitySnapshot
}
