import type { TranslationKey } from '../localization'

export const PROJECT_AWARENESS_PLUGIN_ID = 'project-awareness' as const

export type PluginId = typeof PROJECT_AWARENESS_PLUGIN_ID
export type PluginLifecycleState =
  | 'registered'
  | 'initializing'
  | 'disabled'
  | 'starting'
  | 'active'
  | 'stopping'
  | 'error'
  | 'disposed'
export type PluginHealthState = 'healthy' | 'needs-setup' | 'degraded' | 'error'
export type PluginCapability = 'project-context'

export interface PluginManifest {
  id: PluginId
  version: string
  nameKey: TranslationKey
  descriptionKey: TranslationKey
  defaultEnabled: boolean
  capabilities: readonly PluginCapability[]
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

export interface PluginManagementApi {
  list(): Promise<PluginStatus[]>
  get(id: PluginId): Promise<PluginStatus>
  enable(id: PluginId): Promise<PluginStatus>
  disable(id: PluginId): Promise<PluginStatus>
}
