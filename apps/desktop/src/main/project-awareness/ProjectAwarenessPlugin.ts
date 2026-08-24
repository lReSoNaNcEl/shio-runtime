import type {
  PluginHealth,
  PluginManifest,
  ProjectContextProvider,
  RuntimePluginHealthPresentation,
} from '../../shared/plugins'
import { PROJECT_AWARENESS_PLUGIN_ID } from '../../shared/plugins'
import {
  isValidProjectBranch,
  isValidProjectRepository,
  type ProjectAwarenessPublicConfig,
  type ProjectAwarenessStatus,
} from '../../shared/project-awareness'
import type { BundledPlugin, PluginInitializationContext } from '../plugins/PluginRuntime'
import type {
  ProjectAwarenessConfigStore,
  ProjectAwarenessPluginConfig,
} from './ProjectAwarenessConfigStore'
import type { ProjectAwarenessRuntime } from './ProjectAwarenessRuntime'
import type { LoadedProjectCredential, ProjectCredentialStore } from './ProjectCredentialStore'

export const PROJECT_AWARENESS_MANIFEST: PluginManifest = {
  id: PROJECT_AWARENESS_PLUGIN_ID,
  version: '1.0.0',
  nameKey: 'plugins.projectAwareness.name',
  descriptionKey: 'plugins.projectAwareness.description',
  defaultEnabled: false,
  capabilities: ['project-context'],
}

export interface ProjectAwarenessPluginDependencies {
  config: ProjectAwarenessConfigStore
  credentials: ProjectCredentialStore
  createRuntime(config: ProjectAwarenessPluginConfig): ProjectAwarenessRuntime
  closeStore(): void
}

function credentialProjection(credential: LoadedProjectCredential) {
  return {
    configured: credential.configured,
    source: credential.source,
    secureStorageAvailable: credential.secureStorageAvailable,
    lastError: credential.lastError,
  }
}

export class ProjectAwarenessPlugin implements BundledPlugin {
  readonly manifest = PROJECT_AWARENESS_MANIFEST
  private runtime: ProjectAwarenessRuntime | null = null
  private active = false
  private disposed = false
  private readonly listeners = new Set<() => void>()
  private readonly contextProvider: ProjectContextProvider = {
    resolveRequirement: ({ userText }) =>
      this.requireRuntime().resolveProjectContextRequirement(userText),
    buildContext: async ({ userText, traceId, requirement }) =>
      this.requireRuntime().buildContextPacket(userText, traceId, requirement),
  }

  constructor(private readonly dependencies: ProjectAwarenessPluginDependencies) {}

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(_context: PluginInitializationContext): Promise<void> {
    if (this.runtime) return
    const config = await this.dependencies.config.load()
    const credential = await this.dependencies.credentials.load()
    this.runtime = this.dependencies.createRuntime(config)
    this.runtime.setCredential(credential.token, credentialProjection(credential))
    this.publishChanged()
  }

  async start(): Promise<void> {
    const runtime = this.requireRuntime()
    this.active = true
    await this.trackChange(async () => {
      await runtime.setEnabled(true)
      const config = await this.dependencies.config.load()
      if (
        config.repository &&
        isValidProjectRepository(config.repository) &&
        isValidProjectBranch(config.branch) &&
        runtime.getStatus().credential.configured
      ) {
        await runtime.initialize()
      }
    })
  }

  async stop(): Promise<void> {
    this.active = false
    if (this.runtime) await this.trackChange(() => this.requireRuntime().setEnabled(false))
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.stop()
    this.dependencies.closeStore()
    this.publishChanged()
  }

  getProjectContextProvider(): ProjectContextProvider {
    return this.contextProvider
  }

  async getHealth(): Promise<PluginHealth> {
    const status = this.runtime?.getStatus()
    const config = await this.dependencies.config.load()
    if (
      !status?.credential.configured ||
      !isValidProjectRepository(config.repository) ||
      !isValidProjectBranch(config.branch)
    ) {
      return {
        state: 'needs-setup',
        detailKey: 'plugins.health.needsSetup',
        checkedAt: Date.now(),
      }
    }
    if (status.state === 'error' && !status.snapshot) {
      return { state: 'error', detail: status.lastError, checkedAt: Date.now() }
    }
    return {
      state: 'healthy',
      detailKey: this.active ? 'plugins.health.healthy' : 'plugins.health.disabledHealthy',
      checkedAt: Date.now(),
    }
  }

  getHealthPresentation(): RuntimePluginHealthPresentation {
    // Project identity, freshness, and index details belong to the Plugin surface.
    // Runtime Health remains a high-level lifecycle and health projection.
    return {}
  }

  async getConfig(): Promise<ProjectAwarenessPublicConfig> {
    const { maxFileSizeBytes: _maxFileSizeBytes, ...config } = await this.dependencies.config.load()
    return config
  }

  async configure(config: ProjectAwarenessPublicConfig): Promise<ProjectAwarenessStatus> {
    return this.trackChange(async () => {
      await this.dependencies.config.savePublic(config)
      return this.requireRuntime().configure(config)
    })
  }

  async saveCredential(token: string): Promise<ProjectAwarenessStatus> {
    return this.trackChange(async () => {
      const runtime = this.requireRuntime()
      await runtime.disconnect()
      const credential = await this.dependencies.credentials.save(token)
      runtime.setCredential(credential.token, credentialProjection(credential))
      return runtime.getStatus()
    })
  }

  async forgetCredential(): Promise<ProjectAwarenessStatus> {
    return this.trackChange(async () => {
      const runtime = this.requireRuntime()
      await runtime.disconnect()
      const credential = await this.dependencies.credentials.clear()
      runtime.setCredential(credential.token, credentialProjection(credential))
      return runtime.getStatus()
    })
  }

  getStatus(): ProjectAwarenessStatus {
    return this.requireRuntime().getStatus()
  }

  connect(): Promise<ProjectAwarenessStatus> {
    this.assertActive()
    return this.trackChange(() => this.requireRuntime().connect())
  }

  disconnect(): Promise<ProjectAwarenessStatus> {
    this.assertActive()
    return this.trackChange(() => this.requireRuntime().disconnect())
  }

  sync(): ReturnType<ProjectAwarenessRuntime['sync']> {
    this.assertActive()
    return this.trackChange(() => this.requireRuntime().sync())
  }

  refreshSnapshotStatus(
    force = false,
  ): ReturnType<ProjectAwarenessRuntime['refreshSnapshotStatus']> {
    this.assertActive()
    return this.trackChange(() => this.requireRuntime().refreshSnapshotStatus(force))
  }

  rebuildIndex(): ReturnType<ProjectAwarenessRuntime['rebuildIndex']> {
    this.assertActive()
    return this.trackChange(() => this.requireRuntime().rebuildIndex())
  }

  getProjectMap(): ReturnType<ProjectAwarenessRuntime['getProjectMap']> {
    return this.requireRuntime().getProjectMap()
  }

  search(input: Parameters<ProjectAwarenessRuntime['search']>[0]) {
    this.assertActive()
    return this.requireRuntime().search(input)
  }

  readFile(input: Parameters<ProjectAwarenessRuntime['readFile']>[0]) {
    this.assertActive()
    return this.requireRuntime().readFile(input)
  }

  readSymbol(input: Parameters<ProjectAwarenessRuntime['readSymbol']>[0]) {
    this.assertActive()
    return this.requireRuntime().readSymbol(input)
  }

  getRecentChanges(input: Parameters<ProjectAwarenessRuntime['getRecentChanges']>[0]) {
    this.assertActive()
    return this.requireRuntime().getRecentChanges(input)
  }

  private requireRuntime(): ProjectAwarenessRuntime {
    if (!this.runtime) throw new Error('Project Awareness plugin is not initialized')
    return this.runtime
  }

  private assertActive(): void {
    if (!this.active) throw new Error('Project Awareness plugin is disabled')
  }

  private async trackChange<T>(operation: () => Promise<T>): Promise<T> {
    this.publishChanged()
    try {
      return await operation()
    } finally {
      this.publishChanged()
    }
  }

  private publishChanged(): void {
    for (const listener of this.listeners) listener()
  }
}
