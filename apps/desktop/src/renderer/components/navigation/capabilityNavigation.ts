import type { CapabilityNavigationTarget } from '../../../shared/capabilities'
import { PLUGIN_IDS, type PluginId } from '../../../shared/plugins'

export function pluginIdForNavigationTarget(
  target: CapabilityNavigationTarget,
): PluginId | undefined {
  if (target.kind !== 'plugin') return undefined
  return PLUGIN_IDS.find((id) => id === target.id)
}
