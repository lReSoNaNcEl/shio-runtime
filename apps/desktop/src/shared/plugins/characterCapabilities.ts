import type { TranslationKey } from '../localization'
import type { PluginCapability, PluginId } from './contracts'

export const CHARACTER_CAPABILITY_CONTEXT_SCHEMA_VERSION = 1 as const
export const MAX_CHARACTER_PLUGIN_CAPABILITIES = 32
export const MAX_CHARACTER_CAPABILITY_KINDS_PER_PLUGIN = 16

export type CharacterPluginAvailability =
  | 'available'
  | 'disabled'
  | 'needs-setup'
  | 'degraded'
  | 'unavailable'

/**
 * Bounded, trusted facts about one bundled Plugin. This is environment context,
 * not Character State, Memory, configuration authority, or an invocation surface.
 */
export interface CharacterPluginCapability {
  id: PluginId
  displayNameKey: TranslationKey
  installed: true
  enabled: boolean
  availability: CharacterPluginAvailability
  capabilities: readonly PluginCapability[]
}

export interface CharacterCapabilityContext {
  schemaVersion: typeof CHARACTER_CAPABILITY_CONTEXT_SCHEMA_VERSION
  plugins: readonly CharacterPluginCapability[]
}

/** Resolved before every turn; each returned snapshot is immutable for that turn. */
export interface CharacterCapabilityProvider {
  getSnapshot(): Promise<CharacterCapabilityContext>
}
