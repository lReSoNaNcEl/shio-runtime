import type { BrowserComputerUseProvider } from '../browser-computer-use'
import type { BrowserContextProvider } from '../browser-control'
import type { WebSearchProvider } from '../web-search'
import type { ProjectContextProvider } from './projectContext'

export interface PluginProviderMap {
  'project-context': ProjectContextProvider
  'browser-control': BrowserContextProvider
  'browser-computer-use': BrowserComputerUseProvider
  'web-search': WebSearchProvider
}

export type PluginProviderCapability = keyof PluginProviderMap
export type PluginCapabilityProviders = Partial<{
  [Capability in PluginProviderCapability]: PluginProviderMap[Capability]
}>

export const PLUGIN_PROVIDER_CAPABILITIES = [
  'project-context',
  'browser-control',
  'browser-computer-use',
  'web-search',
] as const satisfies readonly PluginProviderCapability[]
