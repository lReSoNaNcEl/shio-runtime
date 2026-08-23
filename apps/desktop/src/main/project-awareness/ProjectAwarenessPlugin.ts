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
  private readonly contextProvider: ProjectContextProvider = {
    buildContext: async ({ userText, traceId }) =>
      this.requireRuntime().buildContextPacket(userText, traceId),
  }

  constructor(private readonly dependencies: ProjectAwarenessPluginDependencies) {}

  async initialize(_context: PluginInitializationContext): Promise<void> {
    if (this.runtime) return
    const config = await this.dependencies.config.load()
    const credential = await this.dependencies.credentials.load()
    this.runtime = this.dependencies.createRuntime(config)
    this.runtime.setCredential(credential.token, credentialProjection(credential))
  }

  async start(): Promise<void> {
    const runtime = this.requireRuntime()
    this.active = true
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
  }

  async stop(): Promise<void> {
    this.active = false
    if (this.runtime) await this.runtime.setEnabled(false)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.stop()
    this.dependencies.closeStore()
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
    if (status.state === 'error' && !status.indexedCommit) {
      return { state: 'error', detail: status.lastError, checkedAt: Date.now() }
    }
    return {
      state: 'healthy',
      detailKey: this.active ? 'plugins.health.healthy' : 'plugins.health.disabledHealthy',
      checkedAt: Date.now(),
    }
  }

  getHealthPresentation(): RuntimePluginHealthPresentation {
    const status = this.requireRuntime().getStatus()
    const snapshotKey =
      status.freshness === 'fresh'
        ? 'health.project.snapshot.current'
        : status.freshness === 'checking'
          ? 'health.project.snapshot.building'
          : status.freshness === 'stale'
            ? 'health.project.snapshot.stale'
            : status.indexedCommit
              ? 'health.project.snapshot.unknown'
              : 'health.project.snapshot.notBuilt'
    const snapshotCommit = status.indexedCommit ?? status.remoteHead
    const details: RuntimePluginHealthPresentation['details'] = [
      {
        id: 'provider',
        labelKey: 'common.provider',
        value: { kind: 'translation', key: 'common.github' },
      },
      {
        id: 'remote-head',
        labelKey: 'health.project.remoteHead',
        value: status.remoteHead
          ? { kind: 'text', value: status.remoteHead.slice(0, 7), code: true }
          : { kind: 'translation', key: 'common.none' },
      },
      {
        id: 'indexed-commit',
        labelKey: 'health.project.indexedCommit',
        value: status.indexedCommit
          ? { kind: 'text', value: status.indexedCommit.slice(0, 7), code: true }
          : { kind: 'translation', key: 'common.none' },
      },
      {
        id: 'access',
        labelKey: 'health.project.access',
        value: { kind: 'translation', key: 'common.readOnly' },
      },
      ...(!status.credential.configured || !status.credential.secureStorageAvailable
        ? [
            {
              id: 'credential',
              labelKey: 'health.project.credential' as const,
              value: {
                kind: 'translation' as const,
                key: status.credential.secureStorageAvailable
                  ? ('common.notConfigured' as const)
                  : ('health.project.secureStorageUnavailable' as const),
              },
            },
          ]
        : []),
    ]
    return {
      summary: status.repository || undefined,
      context: [status.branch, snapshotCommit?.slice(0, 7)].filter(Boolean).join(' · '),
      contextCode: true,
      statusKey: snapshotKey,
      lastActivityAt: status.lastSyncAt,
      lastActivityLabelKey: 'health.project.syncedRelative',
      details,
    }
  }

  async getConfig(): Promise<ProjectAwarenessPublicConfig> {
    const { maxFileSizeBytes: _maxFileSizeBytes, ...config } = await this.dependencies.config.load()
    return config
  }

  async configure(config: ProjectAwarenessPublicConfig): Promise<ProjectAwarenessStatus> {
    await this.dependencies.config.savePublic(config)
    return this.requireRuntime().configure(config)
  }

  async saveCredential(token: string): Promise<ProjectAwarenessStatus> {
    const runtime = this.requireRuntime()
    await runtime.disconnect()
    const credential = await this.dependencies.credentials.save(token)
    runtime.setCredential(credential.token, credentialProjection(credential))
    return runtime.getStatus()
  }

  async forgetCredential(): Promise<ProjectAwarenessStatus> {
    const runtime = this.requireRuntime()
    await runtime.disconnect()
    const credential = await this.dependencies.credentials.clear()
    runtime.setCredential(credential.token, credentialProjection(credential))
    return runtime.getStatus()
  }

  getStatus(): ProjectAwarenessStatus {
    return this.requireRuntime().getStatus()
  }

  connect(): Promise<ProjectAwarenessStatus> {
    this.assertActive()
    return this.requireRuntime().connect()
  }

  disconnect(): Promise<ProjectAwarenessStatus> {
    this.assertActive()
    return this.requireRuntime().disconnect()
  }

  sync(): ReturnType<ProjectAwarenessRuntime['sync']> {
    this.assertActive()
    return this.requireRuntime().sync()
  }

  refreshSnapshotStatus(
    force = false,
  ): ReturnType<ProjectAwarenessRuntime['refreshSnapshotStatus']> {
    this.assertActive()
    return this.requireRuntime().refreshSnapshotStatus(force)
  }

  rebuildIndex(): ReturnType<ProjectAwarenessRuntime['rebuildIndex']> {
    this.assertActive()
    return this.requireRuntime().rebuildIndex()
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
}
