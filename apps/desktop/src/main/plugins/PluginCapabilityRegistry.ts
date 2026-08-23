import type { BrowserContextProvider } from '../../shared/desktop-control'
import type { PluginId, ProjectContextProvider } from '../../shared/plugins'

export class PluginCapabilityRegistry {
  private projectContext: { owner: PluginId; provider: ProjectContextProvider } | null = null
  private browserContext: { owner: PluginId; provider: BrowserContextProvider } | null = null

  registerProjectContext(owner: PluginId, provider: ProjectContextProvider): void {
    if (this.projectContext && this.projectContext.owner !== owner) {
      throw new Error(`Project context capability is already owned by ${this.projectContext.owner}`)
    }
    this.projectContext = { owner, provider }
  }

  unregisterProjectContext(owner: PluginId): void {
    if (this.projectContext?.owner === owner) this.projectContext = null
  }

  getProjectContextProvider(): ProjectContextProvider | undefined {
    return this.projectContext?.provider
  }

  hasProjectContext(owner: PluginId): boolean {
    return this.projectContext?.owner === owner
  }

  registerBrowserContext(owner: PluginId, provider: BrowserContextProvider): void {
    if (this.browserContext && this.browserContext.owner !== owner) {
      throw new Error(`Browser context capability is already owned by ${this.browserContext.owner}`)
    }
    this.browserContext = { owner, provider }
  }

  unregisterBrowserContext(owner: PluginId): void {
    if (this.browserContext?.owner === owner) this.browserContext = null
  }

  getBrowserContextProvider(): BrowserContextProvider | undefined {
    return this.browserContext?.provider
  }

  hasBrowserContext(owner: PluginId): boolean {
    return this.browserContext?.owner === owner
  }
}
