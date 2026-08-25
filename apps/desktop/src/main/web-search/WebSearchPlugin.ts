import type { PluginHealth, PluginManifest } from '../../shared/plugins'
import { WEB_SEARCH_PLUGIN_ID } from '../../shared/plugins'
import type { WebSearchProvider } from '../../shared/web-search'
import type { BundledPlugin, PluginInitializationContext } from '../plugins/PluginRuntime'
import { DuckDuckGoWebSearchAdapter } from './DuckDuckGoWebSearchAdapter'
import { WebSearchRuntime } from './WebSearchRuntime'

export const WEB_SEARCH_MANIFEST: PluginManifest = {
  id: WEB_SEARCH_PLUGIN_ID,
  version: '1.0.0',
  nameKey: 'plugins.webSearch.name',
  descriptionKey: 'plugins.webSearch.description',
  defaultEnabled: true,
  capabilities: ['web-search'],
}

export class WebSearchPlugin implements BundledPlugin {
  readonly manifest = WEB_SEARCH_MANIFEST
  private active = false
  private initialized = false
  private disposed = false
  private readonly provider: WebSearchProvider = {
    status: () => this.requireActive().status(),
    search: (input, signal) => this.requireActive().search(input, signal),
  }

  constructor(private readonly runtime = new WebSearchRuntime(new DuckDuckGoWebSearchAdapter())) {}

  async initialize(_context: PluginInitializationContext): Promise<void> {
    if (this.disposed) throw new Error('Web Search plugin is disposed')
    this.initialized = true
  }

  async start(): Promise<void> {
    if (!this.initialized) throw new Error('Web Search plugin is not initialized')
    if (this.disposed) throw new Error('Web Search plugin is disposed')
    this.active = true
  }

  async stop(): Promise<void> {
    this.active = false
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.active = false
    this.disposed = true
  }

  getHealth(): PluginHealth {
    const status = this.runtime.status()
    if (status.availability === 'degraded') {
      const detailKey =
        status.reason === 'challenge'
          ? 'plugins.webSearch.health.challenge'
          : status.reason === 'circuit-open'
            ? 'plugins.webSearch.health.circuitOpen'
            : status.reason === 'network-failure'
              ? 'plugins.webSearch.health.networkFailure'
              : 'plugins.webSearch.health.parserFailure'
      return { state: 'degraded', detailKey, checkedAt: Date.now() }
    }
    if (status.availability === 'unavailable') {
      return {
        state: 'error',
        detailKey: 'plugins.webSearch.health.unavailable',
        checkedAt: Date.now(),
      }
    }
    return {
      state: 'healthy',
      detailKey: this.active ? 'plugins.health.healthy' : 'plugins.health.disabledHealthy',
      checkedAt: Date.now(),
    }
  }

  getWebSearchProvider(): WebSearchProvider {
    return this.provider
  }

  private requireActive(): WebSearchRuntime {
    if (!this.active) throw new Error('WEB_SEARCH_PLUGIN_DISABLED')
    return this.runtime
  }
}
