import type { TranslationKey } from '../localization'

export const PROJECT_AWARENESS_PLUGIN_ID = 'project-awareness' as const
export const DESKTOP_CONTROL_PLUGIN_ID = 'desktop-control' as const
export const WEB_SEARCH_PLUGIN_ID = 'web-search' as const
export const BROWSER_GAME_CONTROL_PLUGIN_ID = 'browser-game-control' as const

export type PluginId =
  | typeof PROJECT_AWARENESS_PLUGIN_ID
  | typeof DESKTOP_CONTROL_PLUGIN_ID
  | typeof WEB_SEARCH_PLUGIN_ID
  | typeof BROWSER_GAME_CONTROL_PLUGIN_ID
export type PluginLifecycleState =
  | 'registered'
  | 'initializing'
  | 'disabled'
  | 'waiting-dependencies'
  | 'starting'
  | 'active'
  | 'stopping'
  | 'error'
  | 'disposed'
export type PluginHealthState = 'healthy' | 'needs-setup' | 'degraded' | 'error'
export const PLUGIN_CAPABILITY_KINDS = [
  'project-context',
  'browser-control',
  'automation-engine',
  'computer-control',
  'web-search',
  'browser-realtime-control',
  'browser-game-control',
] as const

export type PluginCapabilityKind = (typeof PLUGIN_CAPABILITY_KINDS)[number]
export type PluginCapability = PluginCapabilityKind

export interface PluginManifest {
  id: PluginId
  version: string
  nameKey: TranslationKey
  descriptionKey: TranslationKey
  defaultEnabled: boolean
  capabilities: readonly PluginCapabilityKind[]
  requiresCapabilities?: readonly PluginCapabilityKind[]
}

export interface PluginHealth {
  state: PluginHealthState
  detailKey?: TranslationKey
  detail?: string
  checkedAt: number
}

export interface PluginStatus {
  manifest: PluginManifest
  enabled: boolean
  lifecycle: PluginLifecycleState
  health: PluginHealth
  busy: boolean
  lastError?: string
}

export type RuntimePluginHealthDetailValue =
  | { kind: 'text'; value: string; code?: boolean }
  | { kind: 'translation'; key: TranslationKey }
  | { kind: 'timestamp'; value: number }

export interface RuntimePluginHealthDetail {
  id: string
  labelKey: TranslationKey
  value: RuntimePluginHealthDetailValue
}

/**
 * Optional dashboard-oriented diagnostic data owned by a Plugin. This contract is
 * deliberately data-only: presentation and navigation behavior remain renderer-owned.
 */
export interface RuntimePluginHealthPresentation {
  summary?: string
  context?: string
  contextCode?: boolean
  statusKey?: TranslationKey
  lastActivityAt?: number
  lastActivityLabelKey?: TranslationKey
  details?: readonly RuntimePluginHealthDetail[]
}

export interface RuntimePluginHealth {
  pluginId: PluginId
  enabled: true
  lifecycle: PluginLifecycleState
  health: PluginHealth
  displayNameKey: TranslationKey
  presentation?: RuntimePluginHealthPresentation
  navigationTarget?: {
    kind: 'open-plugin'
    pluginId: PluginId
  }
}

export interface PluginManagementApi {
  list(): Promise<PluginStatus[]>
  get(id: PluginId): Promise<PluginStatus>
  enable(id: PluginId): Promise<PluginStatus>
  disable(id: PluginId): Promise<PluginStatus>
}
