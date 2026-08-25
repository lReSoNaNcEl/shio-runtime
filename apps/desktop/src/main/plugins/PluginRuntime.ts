import { z } from 'zod'

import type { BrowserContextProvider } from '../../shared/desktop-control'
import type {
  PluginCapabilityKind,
  PluginHealth,
  PluginId,
  PluginManifest,
  PluginStatus,
  ProjectContextProvider,
  RuntimePluginHealth,
  RuntimePluginHealthPresentation,
} from '../../shared/plugins'
import {
  BROWSER_GAME_CONTROL_PLUGIN_ID,
  DESKTOP_CONTROL_PLUGIN_ID,
  PLUGIN_CAPABILITY_KINDS,
  PROJECT_AWARENESS_PLUGIN_ID,
  WEB_SEARCH_PLUGIN_ID,
} from '../../shared/plugins'
import type { WebSearchProvider } from '../../shared/web-search'
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
  getHealthPresentation?():
    | Promise<RuntimePluginHealthPresentation>
    | RuntimePluginHealthPresentation
  getProjectContextProvider?(): ProjectContextProvider
  getBrowserContextProvider?(): BrowserContextProvider
  getWebSearchProvider?(): WebSearchProvider
}

const capabilitySchema = z.enum(PLUGIN_CAPABILITY_KINDS)
const manifestSchema = z
  .object({
    id: z.enum([
      PROJECT_AWARENESS_PLUGIN_ID,
      DESKTOP_CONTROL_PLUGIN_ID,
      WEB_SEARCH_PLUGIN_ID,
      BROWSER_GAME_CONTROL_PLUGIN_ID,
    ]),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    nameKey: z.string().trim().min(1).max(160),
    descriptionKey: z.string().trim().min(1).max(160),
    defaultEnabled: z.boolean(),
    capabilities: z
      .array(capabilitySchema)
      .max(PLUGIN_CAPABILITY_KINDS.length)
      .refine((values) => new Set(values).size === values.length, 'Capabilities must be unique'),
    requiresCapabilities: z
      .array(capabilitySchema)
      .max(PLUGIN_CAPABILITY_KINDS.length)
      .refine(
        (values) => new Set(values).size === values.length,
        'Required capabilities must be unique',
      )
      .optional(),
  })
  .strict()
  .refine(
    (manifest) =>
      !(manifest.requiresCapabilities ?? []).some((capability) =>
        manifest.capabilities.includes(capability),
      ),
    'A Plugin cannot require a capability that it provides',
  )

interface PluginRecord {
  plugin: BundledPlugin
  manifest: PluginManifest
  initialized: boolean
  started: boolean
  enabled: boolean
  lifecycle: PluginStatus['lifecycle']
  health: PluginHealth
  lastError?: string
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

export class PluginRuntime {
  private readonly records = new Map<PluginId, PluginRecord>()
  private readonly listeners = new Set<() => void>()
  private initializePromise: Promise<void> | null = null
  private disposePromise: Promise<void> | null = null
  private lifecycleOperation: Promise<void> = Promise.resolve()

  constructor(
    plugins: readonly BundledPlugin[],
    private readonly registry: PluginRegistryStore,
    private readonly capabilities: PluginCapabilityRegistry,
  ) {
    for (const plugin of plugins) {
      const parsed = manifestSchema.parse(plugin.manifest) as PluginManifest
      const manifest: PluginManifest = Object.freeze({
        ...parsed,
        capabilities: Object.freeze([...parsed.capabilities]),
        ...(parsed.requiresCapabilities
          ? { requiresCapabilities: Object.freeze([...parsed.requiresCapabilities]) }
          : {}),
      })
      if (this.records.has(manifest.id)) throw new Error(`Duplicate plugin id: ${manifest.id}`)
      this.records.set(manifest.id, {
        plugin,
        manifest,
        initialized: false,
        started: false,
        enabled: false,
        lifecycle: 'registered',
        health: { state: 'needs-setup', checkedAt: Date.now() },
      })
    }
  }

  initialize(): Promise<void> {
    this.initializePromise ??= this.enqueueLifecycle(() => this.performInitialize())
    return this.initializePromise
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async list(): Promise<PluginStatus[]> {
    await this.initialize()
    return Promise.all([...this.records.values()].map((record) => this.snapshot(record)))
  }

  async get(id: PluginId): Promise<PluginStatus> {
    await this.initialize()
    return this.snapshot(this.requireRecord(id))
  }

  async listEnabledHealth(): Promise<RuntimePluginHealth[]> {
    await this.initialize()
    const projections = await Promise.all(
      [...this.records.values()].map(async (record): Promise<RuntimePluginHealth | null> => {
        const status = await this.snapshot(record)
        if (!status.enabled) return null
        try {
          return {
            pluginId: status.manifest.id,
            enabled: true,
            lifecycle: status.lifecycle,
            health: status.health,
            displayNameKey: record.manifest.nameKey,
            presentation: await record.plugin.getHealthPresentation?.(),
            navigationTarget: { kind: 'open-plugin', pluginId: status.manifest.id },
          }
        } catch (error) {
          const detail = safeError(error)
          return {
            pluginId: status.manifest.id,
            enabled: true,
            lifecycle: status.lifecycle,
            health: { state: 'error', detail, checkedAt: Date.now() },
            displayNameKey: record.manifest.nameKey,
            navigationTarget: { kind: 'open-plugin', pluginId: status.manifest.id },
          }
        }
      }),
    )
    return projections.filter(
      (projection): projection is RuntimePluginHealth => projection !== null,
    )
  }

  async enable(id: PluginId): Promise<PluginStatus> {
    await this.initialize()
    await this.enqueueLifecycle(async () => {
      const record = this.requireRecord(id)
      if (record.enabled && record.lifecycle === 'active') return
      await this.registry.setEnabled(id, true)
      record.enabled = true
      if (record.lifecycle === 'error') record.lifecycle = 'registered'
      this.publishChanged()
      await this.reconcileDependencies()
    })
    return this.snapshot(this.requireRecord(id))
  }

  async disable(id: PluginId): Promise<PluginStatus> {
    await this.initialize()
    await this.enqueueLifecycle(async () => {
      const record = this.requireRecord(id)
      await this.registry.setEnabled(id, false)
      record.enabled = false
      this.unregisterCapabilities(record)
      const invalidatedDependents = this.invalidateUnsatisfiedDependents()
      await this.deactivate(record, 'disabled')
      await this.stopInvalidatedDependents(invalidatedDependents)
      await this.reconcileDependencies()
    })
    return this.snapshot(this.requireRecord(id))
  }

  dispose(): Promise<void> {
    this.disposePromise ??= this.enqueueLifecycle(async () => {
      for (const record of this.records.values()) this.unregisterCapabilities(record)
      for (const record of this.records.values()) {
        if (record.started) {
          try {
            await record.plugin.stop()
          } finally {
            record.started = false
          }
        }
        if (record.initialized) await record.plugin.dispose()
        record.lifecycle = 'disposed'
        this.publishChanged()
      }
    })
    return this.disposePromise
  }

  private async performInitialize(): Promise<void> {
    await this.registry.load()
    for (const [id, record] of this.records) {
      record.enabled = await this.registry.isEnabled(id)
      try {
        await this.initializeRecord(record)
        if (!record.enabled) {
          record.lifecycle = 'disabled'
          record.health = await record.plugin.getHealth()
        }
      } catch (error) {
        this.fail(record, error)
      }
    }
    await this.reconcileDependencies()
    this.publishChanged()
  }

  private async reconcileDependencies(): Promise<void> {
    let changed = true
    while (changed) {
      changed = false
      const invalidatedDependents = this.invalidateUnsatisfiedDependents()
      if (invalidatedDependents.length > 0) {
        await this.stopInvalidatedDependents(invalidatedDependents)
        changed = true
      }
      for (const record of this.records.values()) {
        if (
          !record.enabled ||
          record.lifecycle === 'active' ||
          record.lifecycle === 'error' ||
          record.lifecycle === 'disposed'
        ) {
          continue
        }
        const missing = this.missingCapabilities(record)
        if (missing.length > 0) {
          this.markDependenciesUnavailable(record, missing)
          continue
        }
        if (await this.activate(record)) changed = true
      }
    }
  }

  private async activate(record: PluginRecord): Promise<boolean> {
    try {
      record.lastError = undefined
      await this.initializeRecord(record)
      record.lifecycle = 'starting'
      this.publishChanged()
      await record.plugin.start()
      record.started = true
      this.registerCapabilities(record)
      record.lifecycle = 'active'
      record.health = await record.plugin.getHealth()
      this.publishChanged()
      return true
    } catch (error) {
      this.unregisterCapabilities(record)
      if (record.started) {
        try {
          await record.plugin.stop()
        } catch {
          // The activation error remains the primary bounded diagnostic.
        }
        record.started = false
      }
      this.fail(record, error)
      return false
    }
  }

  private async deactivate(
    record: PluginRecord,
    lifecycle: 'disabled' | 'waiting-dependencies',
  ): Promise<void> {
    this.unregisterCapabilities(record)
    if (record.started) {
      record.lifecycle = 'stopping'
      this.publishChanged()
      try {
        await record.plugin.stop()
      } catch (error) {
        record.lastError = safeError(error)
      } finally {
        record.started = false
      }
    }
    record.lifecycle = lifecycle
    if (lifecycle === 'disabled') record.health = await record.plugin.getHealth()
    this.publishChanged()
  }

  private invalidateUnsatisfiedDependents(): PluginRecord[] {
    const invalidated: PluginRecord[] = []
    let changed = true
    while (changed) {
      changed = false
      for (const record of this.records.values()) {
        if (!record.enabled || record.lifecycle !== 'active') continue
        const missing = this.missingCapabilities(record)
        if (missing.length === 0) continue
        this.unregisterCapabilities(record)
        record.lifecycle = record.started ? 'stopping' : 'waiting-dependencies'
        record.health = this.dependencyUnavailableHealth(missing)
        invalidated.push(record)
        this.publishChanged()
        changed = true
      }
    }
    return invalidated
  }

  private async stopInvalidatedDependents(records: readonly PluginRecord[]): Promise<void> {
    for (const record of records) {
      if (record.started) {
        try {
          await record.plugin.stop()
        } catch (error) {
          record.lastError = safeError(error)
        } finally {
          record.started = false
        }
      }
      this.markDependenciesUnavailable(record, this.missingCapabilities(record))
    }
  }

  private markDependenciesUnavailable(
    record: PluginRecord,
    missing: readonly PluginCapabilityKind[],
  ): void {
    record.lifecycle = 'waiting-dependencies'
    record.health = this.dependencyUnavailableHealth(missing)
    this.publishChanged()
  }

  private dependencyUnavailableHealth(missing: readonly PluginCapabilityKind[]): PluginHealth {
    return {
      state: 'needs-setup',
      detailKey: 'plugins.health.dependencyUnavailable',
      detail: missing.join(', ').slice(0, 300),
      checkedAt: Date.now(),
    }
  }

  private missingCapabilities(record: PluginRecord): readonly PluginCapabilityKind[] {
    return (record.manifest.requiresCapabilities ?? []).filter(
      (capability) => !this.capabilities.hasCapability(capability),
    )
  }

  private registerCapabilities(record: PluginRecord): void {
    const { manifest } = record
    for (const capability of manifest.capabilities) {
      if (capability === 'project-context') {
        const provider = record.plugin.getProjectContextProvider?.()
        if (!provider) throw new Error(`${manifest.id} did not provide project-context capability`)
        this.capabilities.registerProjectContext(manifest.id, provider)
      } else if (capability === 'browser-control') {
        const provider = record.plugin.getBrowserContextProvider?.()
        if (!provider) throw new Error(`${manifest.id} did not provide browser-control capability`)
        this.capabilities.registerBrowserContext(manifest.id, provider)
      } else if (capability === 'web-search') {
        const provider = record.plugin.getWebSearchProvider?.()
        if (!provider) throw new Error(`${manifest.id} did not provide web-search capability`)
        this.capabilities.registerWebSearch(manifest.id, provider)
      } else {
        this.capabilities.registerOwnedCapability(manifest.id, capability)
      }
    }
  }

  private async initializeRecord(record: PluginRecord): Promise<void> {
    if (record.initialized) return
    record.lifecycle = 'initializing'
    this.publishChanged()
    await record.plugin.initialize({ pluginId: record.manifest.id })
    record.initialized = true
  }

  private unregisterCapabilities(record: PluginRecord): void {
    this.capabilities.unregisterOwner(record.manifest.id)
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
      manifest: record.manifest,
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

  private fail(record: PluginRecord, error: unknown): void {
    record.lifecycle = 'error'
    record.lastError = safeError(error)
    record.health = { state: 'error', detail: record.lastError, checkedAt: Date.now() }
    this.publishChanged()
  }

  private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const next = this.lifecycleOperation.catch(() => undefined).then(operation)
    this.lifecycleOperation = next.catch(() => undefined)
    return next
  }

  private publishChanged(): void {
    for (const listener of this.listeners) listener()
  }
}
