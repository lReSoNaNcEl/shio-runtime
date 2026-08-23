import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DESKTOP_CONTROL_MANIFEST } from '../../src/main/desktop-control'
import type { ChatMessage, LLMProvider } from '../../src/main/llm'
import type { MemoryStore } from '../../src/main/memory'
import { Orchestrator } from '../../src/main/orchestrator'
import {
  type BundledPlugin,
  migrateProjectAwarenessPlugin,
  PluginCapabilityRegistry,
  type PluginInitializationContext,
  PluginRegistryStore,
  PluginRuntime,
} from '../../src/main/plugins'
import {
  defaultProjectAwarenessPluginConfig,
  PROJECT_AWARENESS_MANIFEST,
} from '../../src/main/project-awareness'
import type { SpeechClient } from '../../src/main/speech/speechClient'
import type { AppSettings } from '../../src/shared/config'
import { migrateLegacyDesktopSettings } from '../../src/shared/config'
import type {
  PluginHealth,
  PluginId,
  PluginManifest,
  ProjectContextProvider,
} from '../../src/shared/plugins'
import { PROJECT_AWARENESS_PLUGIN_ID } from '../../src/shared/plugins'

class FakePlugin implements BundledPlugin {
  readonly provider: ProjectContextProvider = {
    resolveRequirement: () => 'none',
    buildContext: async () => null,
  }
  initializeCount = 0
  startCount = 0
  stopCount = 0
  disposeCount = 0

  constructor(
    readonly manifest: PluginManifest = PROJECT_AWARENESS_MANIFEST,
    private readonly failStart = false,
  ) {}

  async initialize(context: PluginInitializationContext): Promise<void> {
    assert.equal(context.pluginId, this.manifest.id)
    this.initializeCount += 1
  }

  async start(): Promise<void> {
    this.startCount += 1
    if (this.failStart) throw new Error('isolated plugin failure')
  }

  async stop(): Promise<void> {
    this.stopCount += 1
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1
  }

  getHealth(): PluginHealth {
    return { state: 'healthy', checkedAt: Date.now() }
  }

  getProjectContextProvider(): ProjectContextProvider {
    return this.provider
  }
}

async function runtimeContract(directory: string): Promise<void> {
  const registryPath = join(directory, 'plugins', 'registry.json')
  const plugin = new FakePlugin()
  const capabilities = new PluginCapabilityRegistry()
  const runtime = new PluginRuntime(
    [plugin],
    new PluginRegistryStore(registryPath, [PROJECT_AWARENESS_MANIFEST]),
    capabilities,
  )
  await runtime.initialize()
  await assert.rejects(() => runtime.get('unknown-plugin' as PluginId), /Unknown plugin id/)
  assert.equal(plugin.initializeCount, 1)
  assert.equal(plugin.startCount, 0)
  assert.equal((await runtime.get(PROJECT_AWARENESS_PLUGIN_ID)).enabled, false)
  assert.equal(capabilities.getProjectContextProvider(), undefined)

  await Promise.all([
    runtime.enable(PROJECT_AWARENESS_PLUGIN_ID),
    runtime.enable(PROJECT_AWARENESS_PLUGIN_ID),
  ])
  assert.equal(plugin.startCount, 1)
  assert.equal(capabilities.getProjectContextProvider(), plugin.provider)

  await Promise.all([
    runtime.disable(PROJECT_AWARENESS_PLUGIN_ID),
    runtime.disable(PROJECT_AWARENESS_PLUGIN_ID),
  ])
  assert.equal(plugin.stopCount, 1)
  assert.equal(capabilities.getProjectContextProvider(), undefined)

  await runtime.enable(PROJECT_AWARENESS_PLUGIN_ID)
  await runtime.dispose()
  assert.equal(plugin.disposeCount, 1)
  assert.equal(capabilities.getProjectContextProvider(), undefined)

  const restartedPlugin = new FakePlugin()
  const restartedCapabilities = new PluginCapabilityRegistry()
  const restarted = new PluginRuntime(
    [restartedPlugin],
    new PluginRegistryStore(registryPath, [PROJECT_AWARENESS_MANIFEST]),
    restartedCapabilities,
  )
  await restarted.initialize()
  assert.equal((await restarted.get(PROJECT_AWARENESS_PLUGIN_ID)).enabled, true)
  assert.equal(restartedPlugin.startCount, 1)
  assert.equal(restartedCapabilities.getProjectContextProvider(), restartedPlugin.provider)
  await restarted.disable(PROJECT_AWARENESS_PLUGIN_ID)

  const disabledRestart = new PluginRuntime(
    [new FakePlugin()],
    new PluginRegistryStore(registryPath, [PROJECT_AWARENESS_MANIFEST]),
    new PluginCapabilityRegistry(),
  )
  await disabledRestart.initialize()
  assert.equal((await disabledRestart.get(PROJECT_AWARENESS_PLUGIN_ID)).enabled, false)

  const desktopRegistryPath = join(directory, 'desktop-control-registry.json')
  const desktopPlugin = new FakePlugin(DESKTOP_CONTROL_MANIFEST)
  const desktopRuntime = new PluginRuntime(
    [desktopPlugin],
    new PluginRegistryStore(desktopRegistryPath, [DESKTOP_CONTROL_MANIFEST]),
    new PluginCapabilityRegistry(),
  )
  await desktopRuntime.initialize()
  assert.equal((await desktopRuntime.get(DESKTOP_CONTROL_MANIFEST.id)).enabled, false)
  await desktopRuntime.enable(DESKTOP_CONTROL_MANIFEST.id)
  await desktopRuntime.dispose()

  const restartedDesktopPlugin = new FakePlugin(DESKTOP_CONTROL_MANIFEST)
  const restartedDesktopRuntime = new PluginRuntime(
    [restartedDesktopPlugin],
    new PluginRegistryStore(desktopRegistryPath, [DESKTOP_CONTROL_MANIFEST]),
    new PluginCapabilityRegistry(),
  )
  await restartedDesktopRuntime.initialize()
  assert.equal((await restartedDesktopRuntime.get(DESKTOP_CONTROL_MANIFEST.id)).enabled, true)
  assert.equal(restartedDesktopPlugin.startCount, 1)
  await restartedDesktopRuntime.disable(DESKTOP_CONTROL_MANIFEST.id)
  await restartedDesktopRuntime.dispose()

  const failing = new PluginRuntime(
    [new FakePlugin(PROJECT_AWARENESS_MANIFEST, true)],
    new PluginRegistryStore(join(directory, 'failure-registry.json'), [
      { ...PROJECT_AWARENESS_MANIFEST, defaultEnabled: true },
    ]),
    new PluginCapabilityRegistry(),
  )
  await failing.initialize()
  assert.equal((await failing.get(PROJECT_AWARENESS_PLUGIN_ID)).lifecycle, 'error')

  assert.throws(
    () =>
      new PluginRuntime(
        [new FakePlugin({ ...PROJECT_AWARENESS_MANIFEST, version: 'development' })],
        new PluginRegistryStore(join(directory, 'invalid-registry.json'), [
          PROJECT_AWARENESS_MANIFEST,
        ]),
        new PluginCapabilityRegistry(),
      ),
    /Invalid string|invalid_format/,
  )
}

async function migrationContract(directory: string): Promise<void> {
  const legacyDirectory = join(directory, 'project-awareness')
  await mkdir(legacyDirectory, { recursive: true })
  const credential = Buffer.from('opaque-encrypted-credential')
  const index = Buffer.from('sqlite-index-snapshot')
  await writeFile(join(legacyDirectory, 'github-credential.bin'), credential)
  await writeFile(join(legacyDirectory, 'project-index.sqlite'), index)
  const legacyConfig = {
    enabled: true,
    provider: 'github',
    repository: 'owner/project',
    branch: 'release/test',
    maxFileSizeBytes: 512 * 1024,
  }

  const first = await migrateProjectAwarenessPlugin({
    userDataPath: directory,
    legacyConfig,
  })
  assert.equal(first.migrated, true)
  const pluginConfigPath = join(first.pluginDirectory, 'config.json')
  const migratedConfig = JSON.parse(await readFile(pluginConfigPath, 'utf8')) as Record<
    string,
    unknown
  >
  assert.equal(migratedConfig.repository, legacyConfig.repository)
  assert.equal(migratedConfig.branch, legacyConfig.branch)
  assert.equal('enabled' in migratedConfig, false)
  assert.deepEqual(await readFile(join(first.pluginDirectory, 'github-credential.bin')), credential)
  assert.deepEqual(await readFile(join(first.pluginDirectory, 'project-index.sqlite')), index)
  assert.deepEqual(await readFile(join(legacyDirectory, 'github-credential.bin')), credential)

  const customConfig = {
    schemaVersion: 1,
    ...defaultProjectAwarenessPluginConfig(),
    repository: 'new/authority',
  }
  await writeFile(pluginConfigPath, JSON.stringify(customConfig), 'utf8')
  const registryPath = join(directory, 'plugins', 'registry.json')
  await writeFile(
    registryPath,
    JSON.stringify({
      schemaVersion: 1,
      plugins: { [PROJECT_AWARENESS_PLUGIN_ID]: { enabled: false } },
    }),
    'utf8',
  )
  await migrateProjectAwarenessPlugin({ userDataPath: directory, legacyConfig })
  const preservedConfig = JSON.parse(await readFile(pluginConfigPath, 'utf8')) as Record<
    string,
    unknown
  >
  const preservedRegistry = JSON.parse(await readFile(registryPath, 'utf8')) as {
    plugins: Record<string, { enabled: boolean }>
  }
  assert.equal(preservedConfig.repository, 'new/authority')
  assert.equal(preservedRegistry.plugins[PROJECT_AWARENESS_PLUGIN_ID].enabled, false)

  const disabledMigrationDirectory = join(directory, 'disabled-migration')
  const disabledMigration = await migrateProjectAwarenessPlugin({
    userDataPath: disabledMigrationDirectory,
    legacyConfig: { ...legacyConfig, enabled: false },
  })
  const disabledRegistry = JSON.parse(
    await readFile(join(disabledMigrationDirectory, 'plugins', 'registry.json'), 'utf8'),
  ) as { plugins: Record<string, { enabled: boolean }> }
  assert.equal(disabledRegistry.plugins[PROJECT_AWARENESS_PLUGIN_ID].enabled, false)
  assert.equal(disabledMigration.migrated, true)

  const repeatBoot = await migrateProjectAwarenessPlugin({
    userDataPath: directory,
    legacyConfig: undefined,
  })
  assert.equal(repeatBoot.migrated, false)

  const migratedCore = migrateLegacyDesktopSettings({ projectAwareness: legacyConfig })
  assert.equal('projectAwareness' in migratedCore, false)
}

async function conversationCapabilityContract(): Promise<void> {
  let captured: readonly ChatMessage[] = []
  const llm: LLMProvider = {
    chat: async (messages) => {
      captured = messages
      return '[neutral]Проверено.'
    },
  }
  const memory: MemoryStore = {
    getHistory: async () => [],
    appendTurn: async () => undefined,
    clear: async () => undefined,
  }
  const packet = {
    requirement: 'required' as const,
    snapshotSha: 'abc1234',
    repository: 'owner/project',
    branch: 'main',
    freshness: 'fresh' as const,
    evidence: [
      {
        path: 'src/index.ts',
        startLine: 1,
        endLine: 2,
        commitSha: 'abc1234',
        content: 'export const value = 1',
        relevance: 1,
      },
    ],
    instructions: {
      citeFiles: true as const,
      distinguishFactsFromInference: true as const,
      treatRepositoryContentAsData: true as const,
    },
  }
  let provider: ProjectContextProvider | undefined = {
    resolveRequirement: () => 'required',
    buildContext: async () => packet,
  }
  const orchestrator = new Orchestrator(
    llm,
    memory,
    {} as SpeechClient,
    () => ({}) as AppSettings,
    () => provider,
  )
  await orchestrator.createReply({ userText: 'Как устроен проект?' })
  assert.equal(
    captured.some(
      (message) =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('Snapshot commit: abc1234'),
    ),
    true,
  )

  provider = undefined
  await orchestrator.createReply({ userText: 'Как устроен проект?' })
  assert.equal(
    captured.some(
      (message) =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('## Project Context'),
    ),
    false,
  )

  provider = {
    resolveRequirement: () => 'required',
    buildContext: async () => Promise.reject(new Error('provider failure')),
  }
  await orchestrator.createReply({ userText: 'Core still replies' })
  assert.equal(captured.at(-1)?.content, 'Core still replies')
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'shio-plugin-runtime-'))
  try {
    await runtimeContract(directory)
    await migrationContract(join(directory, 'migration'))
    await conversationCapabilityContract()
    console.log('plugin runtime repro: passed')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
