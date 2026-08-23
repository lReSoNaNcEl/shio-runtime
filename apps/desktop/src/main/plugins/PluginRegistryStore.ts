import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import type { PluginId, PluginManifest } from '../../shared/plugins'

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

  constructor(
    private readonly filePath: string,
    private readonly manifests: readonly PluginManifest[],
  ) {}

  async load(): Promise<void> {
    if (this.document) return
    let saved: PluginRegistryDocument | null = null
    try {
      saved = registrySchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') throw error
    }
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
    const plugins = { ...(saved?.plugins ?? {}) }
    for (const manifest of this.manifests) {
      plugins[manifest.id] ??= { enabled: manifest.defaultEnabled }
    }
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, plugins }
  }

  private async persist(document: PluginRegistryDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(document, null, 2), 'utf8')
    await rename(temporaryPath, this.filePath)
  }
}

export const pluginRegistrySchemaVersion = REGISTRY_SCHEMA_VERSION
