import { BrowserControlPlugin, type BrowserControlPluginDependencies } from '../../browser-control'

export function buildBrowserControlPlugin(
  dependencies: BrowserControlPluginDependencies,
): BrowserControlPlugin {
  return new BrowserControlPlugin(dependencies)
}
