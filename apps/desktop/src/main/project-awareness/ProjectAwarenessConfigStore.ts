import { z } from 'zod'

import type { ProjectAwarenessPublicConfig } from '../../shared/project-awareness'
import { ValidatedElectronStore } from '../persistence/ValidatedElectronStore'

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
  private readonly store: ValidatedElectronStore<z.infer<typeof projectConfigSchema>>

  constructor(filePath: string) {
    this.store = new ValidatedElectronStore(filePath, projectConfigSchema)
  }

  async load(): Promise<ProjectAwarenessPluginConfig> {
    if (this.config) return { ...this.config }
    const saved = this.store.read()
    if (saved) {
      const { schemaVersion: _schemaVersion, ...config } = saved
      this.config = config
    } else {
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
    this.store.write({ schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION, ...config })
  }
}

export const defaultProjectAwarenessPluginConfig = (): ProjectAwarenessPluginConfig => ({
  ...DEFAULT_CONFIG,
})
