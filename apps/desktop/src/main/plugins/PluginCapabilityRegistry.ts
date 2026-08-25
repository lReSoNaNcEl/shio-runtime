import type {
  BrowserContextProvider,
  BrowserRealtimeControlProvider,
} from '../../shared/desktop-control'
import type { PluginCapabilityKind, PluginId, ProjectContextProvider } from '../../shared/plugins'
import type { WebSearchProvider } from '../../shared/web-search'

interface ProviderRegistration<T> {
  owner: PluginId
  provider: T
}

export class PluginCapabilityRegistry {
  private readonly owners = new Map<PluginCapabilityKind, PluginId>()
  private projectContext: ProviderRegistration<ProjectContextProvider> | null = null
  private browserContext: ProviderRegistration<BrowserContextProvider> | null = null
  private browserRealtimeControl: ProviderRegistration<BrowserRealtimeControlProvider> | null = null
  private webSearch: ProviderRegistration<WebSearchProvider> | null = null

  registerProjectContext(owner: PluginId, provider: ProjectContextProvider): void {
    this.claim(owner, 'project-context')
    this.projectContext = { owner, provider }
  }

  getProjectContextProvider(): ProjectContextProvider | undefined {
    return this.projectContext?.provider
  }

  hasProjectContext(owner: PluginId): boolean {
    return this.projectContext?.owner === owner
  }

  registerBrowserContext(owner: PluginId, provider: BrowserContextProvider): void {
    this.claim(owner, 'browser-control')
    this.browserContext = { owner, provider }
  }

  getBrowserContextProvider(): BrowserContextProvider | undefined {
    return this.browserContext?.provider
  }

  hasBrowserContext(owner: PluginId): boolean {
    return this.browserContext?.owner === owner
  }

  registerBrowserRealtimeControl(owner: PluginId, provider: BrowserRealtimeControlProvider): void {
    this.claim(owner, 'browser-realtime-control')
    this.browserRealtimeControl = { owner, provider }
  }

  getBrowserRealtimeControlProvider(): BrowserRealtimeControlProvider | undefined {
    return this.browserRealtimeControl?.provider
  }

  hasBrowserRealtimeControl(owner: PluginId): boolean {
    return this.browserRealtimeControl?.owner === owner
  }

  registerWebSearch(owner: PluginId, provider: WebSearchProvider): void {
    this.claim(owner, 'web-search')
    this.webSearch = { owner, provider }
  }

  getWebSearchProvider(): WebSearchProvider | undefined {
    return this.webSearch?.provider
  }

  hasWebSearch(owner: PluginId): boolean {
    return this.webSearch?.owner === owner
  }

  registerOwnedCapability(owner: PluginId, capability: PluginCapabilityKind): void {
    this.claim(owner, capability)
  }

  hasCapability(capability: PluginCapabilityKind): boolean {
    return this.owners.has(capability)
  }

  ownerOf(capability: PluginCapabilityKind): PluginId | undefined {
    return this.owners.get(capability)
  }

  unregisterOwner(owner: PluginId): void {
    for (const [capability, currentOwner] of this.owners) {
      if (currentOwner === owner) this.owners.delete(capability)
    }
    if (this.projectContext?.owner === owner) this.projectContext = null
    if (this.browserContext?.owner === owner) this.browserContext = null
    if (this.browserRealtimeControl?.owner === owner) this.browserRealtimeControl = null
    if (this.webSearch?.owner === owner) this.webSearch = null
  }

  private claim(owner: PluginId, capability: PluginCapabilityKind): void {
    const currentOwner = this.owners.get(capability)
    if (currentOwner && currentOwner !== owner) {
      throw new Error(`${capability} capability is already owned by ${currentOwner}`)
    }
    this.owners.set(capability, owner)
  }
}
