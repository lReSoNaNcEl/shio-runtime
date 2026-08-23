import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import type { ProjectAwarenessPublicConfig } from '../../shared/project-awareness'

const PROJECT_CONFIG_SCHEMA_VERSION = 1
const projectConfigSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_CONFIG_SCHEMA_VERSION),
    provider: z.literal('github'),
    repository: z.string().max(200),
    branch: z.string().min(1).max(255),
    maxFileSizeBytes: z
      .number()
      .int()
      .min(16 * 1024)
      .max(2 * 1024 * 1024),
  })
  .strict()

export interface ProjectAwarenessPluginConfig extends ProjectAwarenessPublicConfig {
  maxFileSizeBytes: number
}

const DEFAULT_CONFIG: ProjectAwarenessPluginConfig = {
  provider: 'github',
  repository: '',
  branch: 'main',
  maxFileSizeBytes: 256 * 1024,
}

export class ProjectAwarenessConfigStore {
  private config: ProjectAwarenessPluginConfig | null = null

  constructor(private readonly filePath: string) {}

  async load(): Promise<ProjectAwarenessPluginConfig> {
    if (this.config) return { ...this.config }
    try {
      const saved = projectConfigSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
      const { schemaVersion: _schemaVersion, ...config } = saved
      this.config = config
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') throw error
      const config = { ...DEFAULT_CONFIG }
      await this.persist(config)
      this.config = config
    }
    return { ...this.config }
  }

  async save(config: ProjectAwarenessPluginConfig): Promise<ProjectAwarenessPluginConfig> {
    const next = projectConfigSchema
      .omit({ schemaVersion: true })
      .parse(config) as ProjectAwarenessPluginConfig
    await this.persist(next)
    this.config = next
    return { ...next }
  }

  async savePublic(config: ProjectAwarenessPublicConfig): Promise<ProjectAwarenessPluginConfig> {
    const current = await this.load()
    return this.save({ ...current, ...config })
  }

  private async persist(config: ProjectAwarenessPluginConfig): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(
      temporaryPath,
      JSON.stringify({ schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION, ...config }, null, 2),
      'utf8',
    )
    await rename(temporaryPath, this.filePath)
  }
}

export const defaultProjectAwarenessPluginConfig = (): ProjectAwarenessPluginConfig => ({
  ...DEFAULT_CONFIG,
})
