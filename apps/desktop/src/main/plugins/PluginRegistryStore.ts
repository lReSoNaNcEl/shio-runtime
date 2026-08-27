import { z } from 'zod'

import type { PluginId, PluginManifest } from '../../shared/plugins'
import { ValidatedElectronStore } from '../persistence/ValidatedElectronStore'

const REGISTRY_SCHEMA_VERSION = 1
const registrySchema = z
  .object({
    schemaVersion: z.literal(REGISTRY_SCHEMA_VERSION),
    plugins: z.record(z.string(), z.object({ enabled: z.boolean() }).strict()),
  })
  .strict()

interface PluginRegistryDocument {
  schemaVersion: typeof REGISTRY_SCHEMA_VERSION
  plugins: Record<string, { enabled: boolean }>
}

export class PluginRegistryStore {
  private document: PluginRegistryDocument | null = null
  private readonly store: ValidatedElectronStore<PluginRegistryDocument>

  constructor(
    filePath: string,
    private readonly manifests: readonly PluginManifest[],
  ) {
    this.store = new ValidatedElectronStore(filePath, registrySchema)
  }

  async load(): Promise<void> {
    if (this.document) return
    const saved = this.store.read()
    const document = this.withDefaults(saved)
    if (!saved || JSON.stringify(saved) !== JSON.stringify(document)) await this.persist(document)
    this.document = document
  }

  async isEnabled(id: PluginId): Promise<boolean> {
    await this.load()
    return this.document?.plugins[id]?.enabled ?? false
  }

  async setEnabled(id: PluginId, enabled: boolean): Promise<void> {
    await this.load()
    if (!this.document) throw new Error('Plugin registry is unavailable')
    const document = {
      ...this.document,
      plugins: { ...this.document.plugins, [id]: { enabled } },
    }
    await this.persist(document)
    this.document = document
  }

  private withDefaults(saved: PluginRegistryDocument | null): PluginRegistryDocument {
    const plugins: Record<string, { enabled: boolean }> = {}
    for (const manifest of this.manifests) {
      plugins[manifest.id] = saved?.plugins[manifest.id] ?? { enabled: manifest.defaultEnabled }
    }
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, plugins }
  }

  private async persist(document: PluginRegistryDocument): Promise<void> {
    this.store.write(document)
  }
}

export const pluginRegistrySchemaVersion = REGISTRY_SCHEMA_VERSION
