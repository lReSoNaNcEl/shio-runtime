import type { PluginId, ProjectContextProvider } from '../../shared/plugins'

export class PluginCapabilityRegistry {
  private projectContext: { owner: PluginId; provider: ProjectContextProvider } | null = null

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
}
