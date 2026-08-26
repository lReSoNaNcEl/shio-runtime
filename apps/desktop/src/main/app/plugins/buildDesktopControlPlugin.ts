import { DesktopControlPlugin, type DesktopControlPluginDependencies } from '../../desktop-control'

export function buildDesktopControlPlugin(
  dependencies: DesktopControlPluginDependencies,
): DesktopControlPlugin {
  return new DesktopControlPlugin(dependencies)
}
