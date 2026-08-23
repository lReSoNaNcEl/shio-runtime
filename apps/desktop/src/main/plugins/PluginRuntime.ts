import { z } from 'zod'

import type {
  PluginHealth,
  PluginId,
  PluginManifest,
  PluginStatus,
  ProjectContextProvider,
} from '../../shared/plugins'
import { PROJECT_AWARENESS_PLUGIN_ID } from '../../shared/plugins'
import type { PluginCapabilityRegistry } from './PluginCapabilityRegistry'
import type { PluginRegistryStore } from './PluginRegistryStore'

export interface PluginInitializationContext {
  pluginId: PluginId
}

export interface BundledPlugin {
  readonly manifest: PluginManifest
  initialize(context: PluginInitializationContext): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  dispose(): Promise<void>
  getHealth(): Promise<PluginHealth> | PluginHealth
  getProjectContextProvider?(): ProjectContextProvider
}

const manifestSchema = z
  .object({
    id: z.literal(PROJECT_AWARENESS_PLUGIN_ID),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    nameKey: z.string().min(1),
    descriptionKey: z.string().min(1),
    defaultEnabled: z.boolean(),
    capabilities: z.array(z.literal('project-context')).max(1),
  })
  .strict()

interface PluginRecord {
  plugin: BundledPlugin
  initialized: boolean
  enabled: boolean
  lifecycle: PluginStatus['lifecycle']
  health: PluginHealth
  lastError?: string
  operation: Promise<void>
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

export class PluginRuntime {
  private readonly records = new Map<PluginId, PluginRecord>()
  private initializePromise: Promise<void> | null = null
  private disposePromise: Promise<void> | null = null

  constructor(
    plugins: readonly BundledPlugin[],
    private readonly registry: PluginRegistryStore,
    private readonly capabilities: PluginCapabilityRegistry,
  ) {
    for (const plugin of plugins) {
      const manifest = manifestSchema.parse(plugin.manifest) as PluginManifest
      if (this.records.has(manifest.id)) throw new Error(`Duplicate plugin id: ${manifest.id}`)
      this.records.set(manifest.id, {
        plugin,
        initialized: false,
        enabled: false,
        lifecycle: 'registered',
        health: { state: 'needs-setup', checkedAt: Date.now() },
        operation: Promise.resolve(),
      })
    }
  }

  initialize(): Promise<void> {
    this.initializePromise ??= this.performInitialize()
    return this.initializePromise
  }

  private async performInitialize(): Promise<void> {
    await this.registry.load()
    await Promise.all(
      [...this.records.keys()].map(async (id) => {
        const record = this.requireRecord(id)
        record.enabled = await this.registry.isEnabled(id)
        await this.enqueue(record, async () => {
          try {
            await this.initializeRecord(record)
            if (record.enabled) await this.activate(record)
            else {
              record.lifecycle = 'disabled'
              record.health = await record.plugin.getHealth()
            }
          } catch (error) {
            record.lifecycle = 'error'
            record.lastError = safeError(error)
            record.health = { state: 'error', detail: record.lastError, checkedAt: Date.now() }
          }
        })
      }),
    )
  }

  async list(): Promise<PluginStatus[]> {
    await this.initialize()
    return Promise.all([...this.records.values()].map((record) => this.snapshot(record)))
  }

  async get(id: PluginId): Promise<PluginStatus> {
    await this.initialize()
    return this.snapshot(this.requireRecord(id))
  }

  async enable(id: PluginId): Promise<PluginStatus> {
    await this.initialize()
    const record = this.requireRecord(id)
    await this.enqueue(record, async () => {
      if (record.enabled && record.lifecycle === 'active') return
      await this.registry.setEnabled(id, true)
      record.enabled = true
      await this.activate(record)
    })
    return this.snapshot(record)
  }

  async disable(id: PluginId): Promise<PluginStatus> {
    await this.initialize()
    const record = this.requireRecord(id)
    await this.enqueue(record, async () => {
      await this.registry.setEnabled(id, false)
      record.enabled = false
      this.unregisterCapabilities(record)
      if (record.initialized && record.lifecycle !== 'disabled') {
        record.lifecycle = 'stopping'
        try {
          await record.plugin.stop()
        } catch (error) {
          record.lastError = safeError(error)
        }
      }
      record.lifecycle = 'disabled'
      record.health = await record.plugin.getHealth()
    })
    return this.snapshot(record)
  }

  dispose(): Promise<void> {
    this.disposePromise ??= Promise.all(
      [...this.records.values()].map((record) =>
        this.enqueue(record, async () => {
          this.unregisterCapabilities(record)
          if (record.initialized) {
            try {
              await record.plugin.stop()
            } finally {
              await record.plugin.dispose()
            }
          }
          record.lifecycle = 'disposed'
        }),
      ),
    ).then(() => undefined)
    return this.disposePromise
  }

  private async activate(record: PluginRecord): Promise<void> {
    try {
      record.lastError = undefined
      await this.initializeRecord(record)
      record.lifecycle = 'starting'
      await record.plugin.start()
      this.registerCapabilities(record)
      record.lifecycle = 'active'
      record.health = await record.plugin.getHealth()
    } catch (error) {
      this.unregisterCapabilities(record)
      record.lifecycle = 'error'
      record.lastError = safeError(error)
      record.health = { state: 'error', detail: record.lastError, checkedAt: Date.now() }
    }
  }

  private registerCapabilities(record: PluginRecord): void {
    const { manifest } = record.plugin
    if (!manifest.capabilities.includes('project-context')) return
    const provider = record.plugin.getProjectContextProvider?.()
    if (!provider) throw new Error(`${manifest.id} did not provide project-context capability`)
    this.capabilities.registerProjectContext(manifest.id, provider)
  }

  private async initializeRecord(record: PluginRecord): Promise<void> {
    if (record.initialized) return
    record.lifecycle = 'initializing'
    await record.plugin.initialize({ pluginId: record.plugin.manifest.id })
    record.initialized = true
  }

  private unregisterCapabilities(record: PluginRecord): void {
    this.capabilities.unregisterProjectContext(record.plugin.manifest.id)
  }

  private async snapshot(record: PluginRecord): Promise<PluginStatus> {
    if (record.lifecycle === 'active' || record.lifecycle === 'disabled') {
      record.health = await record.plugin.getHealth()
      if (record.lifecycle === 'active') {
        if (record.health.state === 'error') this.unregisterCapabilities(record)
        else this.registerCapabilities(record)
      }
    }
    return {
      manifest: record.plugin.manifest,
      enabled: record.enabled,
      lifecycle: record.lifecycle,
      health: record.health,
      busy: ['initializing', 'starting', 'stopping'].includes(record.lifecycle),
      lastError: record.lastError,
    }
  }

  private requireRecord(id: PluginId): PluginRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`Unknown plugin id: ${id}`)
    return record
  }

  private enqueue(record: PluginRecord, operation: () => Promise<void>): Promise<void> {
    const next = record.operation.catch(() => undefined).then(operation)
    record.operation = next.catch(() => undefined)
    return next
  }
}
