import { constants } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { PROJECT_AWARENESS_PLUGIN_ID } from '../../shared/plugins'
import {
  defaultProjectAwarenessPluginConfig,
  ProjectAwarenessConfigStore,
} from '../project-awareness/ProjectAwarenessConfigStore'

interface MigrationInput {
  userDataPath: string
  legacyConfig: unknown
}

export interface ProjectAwarenessPluginMigrationResult {
  legacyFound: boolean
  migrated: boolean
  pluginDirectory: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.migration.tmp`
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporaryPath, path)
}

async function copyMissingTree(source: string, destination: string): Promise<void> {
  if (!(await exists(source))) return
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name)
    const destinationPath = join(destination, entry.name)
    if (entry.isDirectory()) {
      await copyMissingTree(sourcePath, destinationPath)
    } else if (entry.isFile() && !(await exists(destinationPath))) {
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
    }
  }
}

function legacyProjectConfig(value: unknown) {
  const defaults = defaultProjectAwarenessPluginConfig()
  if (!isObject(value)) return defaults
  return {
    schemaVersion: 1,
    provider: 'github' as const,
    repository: typeof value.repository === 'string' ? value.repository : defaults.repository,
    branch:
      typeof value.branch === 'string' && value.branch.trim() ? value.branch : defaults.branch,
    maxFileSizeBytes:
      typeof value.maxFileSizeBytes === 'number' &&
      Number.isFinite(value.maxFileSizeBytes) &&
      value.maxFileSizeBytes >= 16 * 1024
        ? Math.min(value.maxFileSizeBytes, 2 * 1024 * 1024)
        : defaults.maxFileSizeBytes,
  }
}

export async function migrateProjectAwarenessPlugin({
  userDataPath,
  legacyConfig,
}: MigrationInput): Promise<ProjectAwarenessPluginMigrationResult> {
  const legacyFound = isObject(legacyConfig)
  const pluginDirectory = join(userDataPath, 'plugins', PROJECT_AWARENESS_PLUGIN_ID)
  if (!legacyFound) return { legacyFound, migrated: false, pluginDirectory }

  const pluginConfigPath = join(pluginDirectory, 'config.json')
  if (!(await exists(pluginConfigPath))) {
    await writeJsonAtomic(pluginConfigPath, legacyProjectConfig(legacyConfig))
  }

  const legacyDirectory = join(userDataPath, 'project-awareness')
  if (basename(legacyDirectory) !== 'project-awareness') {
    throw new Error('Unexpected legacy Project Awareness directory')
  }
  await copyMissingTree(legacyDirectory, pluginDirectory)

  const registryPath = join(userDataPath, 'plugins', 'registry.json')
  let registry: Record<string, unknown> = { schemaVersion: 1, plugins: {} }
  if (await exists(registryPath)) {
    const parsed = JSON.parse(await readFile(registryPath, 'utf8')) as unknown
    if (!isObject(parsed)) throw new Error('Invalid plugin registry document')
    registry = parsed
  }
  const plugins = isObject(registry.plugins) ? { ...registry.plugins } : {}
  if (!isObject(plugins[PROJECT_AWARENESS_PLUGIN_ID])) {
    const legacy = legacyConfig as Record<string, unknown>
    plugins[PROJECT_AWARENESS_PLUGIN_ID] = {
      enabled:
        legacy.enabled === true &&
        typeof legacy.repository === 'string' &&
        legacy.repository.trim().length > 0,
    }
    await writeJsonAtomic(registryPath, { ...registry, schemaVersion: 1, plugins })
  }

  const configStat = await stat(pluginConfigPath)
  if (!configStat.isFile()) throw new Error('Project Awareness plugin config was not created')
  await new ProjectAwarenessConfigStore(pluginConfigPath).load()
  const verifiedRegistry = JSON.parse(await readFile(registryPath, 'utf8')) as unknown
  if (
    !isObject(verifiedRegistry) ||
    !isObject(verifiedRegistry.plugins) ||
    !isObject(verifiedRegistry.plugins[PROJECT_AWARENESS_PLUGIN_ID]) ||
    typeof verifiedRegistry.plugins[PROJECT_AWARENESS_PLUGIN_ID].enabled !== 'boolean'
  ) {
    throw new Error('Project Awareness registry migration verification failed')
  }
  return { legacyFound, migrated: true, pluginDirectory }
}
