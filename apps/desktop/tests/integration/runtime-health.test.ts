import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vitest'

import {
  type BundledPlugin,
  PluginCapabilityRegistry,
  type PluginInitializationContext,
  PluginRegistryStore,
  PluginRuntime,
} from '../../src/main/plugins'
import { PROJECT_AWARENESS_MANIFEST } from '../../src/main/project-awareness'
import {
  aggregateHealth,
  formatRelativeTime,
  pluginHealthSeverity,
} from '../../src/renderer/runtime/runtimeHealth'
import type {
  PluginCapabilityProviders,
  PluginHealth,
  ProjectContextProvider,
  RuntimePluginHealthPresentation,
} from '../../src/shared/plugins'
import { PROJECT_AWARENESS_PLUGIN_ID } from '../../src/shared/plugins'

const desktopRoot = process.cwd().endsWith('apps\\desktop')
  ? process.cwd()
  : join(process.cwd(), 'apps', 'desktop')

function source(relativePath: string): Promise<string> {
  return readFile(join(desktopRoot, relativePath), 'utf8')
}

class HealthPlugin implements BundledPlugin {
  readonly manifest = PROJECT_AWARENESS_MANIFEST
  private health: PluginHealth = { state: 'healthy', checkedAt: Date.now() }
  private readonly provider: ProjectContextProvider = {
    search: async () => null,
  }

  initialize(context: PluginInitializationContext): Promise<void> {
    assert.equal(context.pluginId, PROJECT_AWARENESS_PLUGIN_ID)
    return Promise.resolve()
  }

  start(): Promise<void> {
    return Promise.resolve()
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }

  getHealth(): PluginHealth {
    return this.health
  }

  getHealthPresentation(): RuntimePluginHealthPresentation {
    return { summary: 'owner/repository', context: 'main · abc1234', contextCode: true }
  }

  getProjectContextProvider(): ProjectContextProvider {
    return this.provider
  }

  getCapabilityProviders(): PluginCapabilityProviders {
    return { 'project-context': this.getProjectContextProvider() }
  }

  setHealth(state: PluginHealth['state']): void {
    this.health = { state, checkedAt: Date.now() }
  }
}

async function pluginFiltering(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'shio-runtime-health-'))
  const plugin = new HealthPlugin()
  const runtime = new PluginRuntime(
    [plugin],
    new PluginRegistryStore(join(directory, 'registry.json'), [PROJECT_AWARENESS_MANIFEST]),
    new PluginCapabilityRegistry(),
  )
  try {
    await runtime.initialize()
    assert.deepEqual(await runtime.listEnabledHealth(), [], 'disabled Plugin must be absent')

    await runtime.enable(PROJECT_AWARENESS_PLUGIN_ID)
    let enabled = await runtime.listEnabledHealth()
    assert.equal(enabled.length, 1, 'enabled Plugin must appear without restart')
    assert.equal(enabled[0].enabled, true)
    assert.equal(enabled[0].presentation?.summary, 'owner/repository')

    plugin.setHealth('needs-setup')
    enabled = await runtime.listEnabledHealth()
    assert.equal(pluginHealthSeverity(enabled[0]), 'healthy')
    assert.equal(
      aggregateHealth([{ enabled: true, severity: pluginHealthSeverity(enabled[0]) }]),
      'healthy',
      'optional setup readiness must not become an application health warning',
    )

    await runtime.disable(PROJECT_AWARENESS_PLUGIN_ID)
    assert.deepEqual(
      await runtime.listEnabledHealth(),
      [],
      'disable must remove card without restart',
    )
    assert.equal(
      aggregateHealth([{ enabled: false, severity: 'error' }]),
      'healthy',
      'disabled optional capability must not affect aggregate health',
    )

    plugin.setHealth('error')
    await runtime.enable(PROJECT_AWARENESS_PLUGIN_ID)
    enabled = await runtime.listEnabledHealth()
    assert.equal(pluginHealthSeverity(enabled[0]), 'error')
    assert.equal(
      aggregateHealth([{ enabled: true, severity: pluginHealthSeverity(enabled[0]) }]),
      'error',
    )
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}

function aggregateSemantics(): void {
  assert.equal(
    aggregateHealth([
      { enabled: true, severity: 'healthy' },
      { enabled: true, severity: 'healthy' },
      { enabled: false, severity: 'error' },
    ]),
    'healthy',
    'healthy Speech + healthy LLM + Streaming off must be healthy',
  )
  assert.equal(aggregateHealth([{ enabled: true, severity: 'error' }]), 'error')
  assert.equal(aggregateHealth([{ enabled: true, severity: 'degraded' }]), 'notice')
}

function relativeTimeSemantics(): void {
  const now = Date.UTC(2026, 7, 23, 6, 30, 0)
  assert.equal(formatRelativeTime(now - 120_000, 'ru', 'только что', now), '2 минуты назад')
  assert.equal(formatRelativeTime(now - 120_000, 'en', 'just now', now), '2 minutes ago')
  assert.equal(formatRelativeTime(now - 10_000, 'ru', 'только что', now), 'только что')
}

async function staticUiContract(): Promise<void> {
  const [system, diagnostics, app, appShell, status, supportHook] = await Promise.all([
    source('src/renderer/components/diagnostics/SystemDiagnostics.tsx'),
    source('src/renderer/components/views/DiagnosticsView.tsx'),
    source('src/renderer/components/App.tsx'),
    source('src/renderer/components/shell/AppShell.tsx'),
    source('src/renderer/components/shell/RuntimeStatusIndicator.tsx'),
    source('src/renderer/hooks/useRuntimeSupportBundle.ts'),
  ])
  await assert.rejects(source('src/renderer/components/views/RuntimeHealthView.tsx'))
  assert.doesNotMatch(app, /RuntimeHealthView|section === 'health'/)
  assert.doesNotMatch(appShell, /id: 'health'|onSectionChange\('health'\)/)
  assert.match(system, /buildRuntimeHealthProjection/)
  assert.match(diagnostics, /SystemDiagnostics/)
  assert.match(app, /buildRuntimeHealthProjection/)
  assert.match(status, /<Popover/)
  assert.match(status, /issues\.map/)
  assert.match(status, /openDiagnostics/)
  assert.match(status, /copyReport/)
  assert.match(supportHook, /const RUNTIME_SUPPORT_REFRESH_MS = 30_000/)
  assert.match(supportHook, /setInterval\([\s\S]*?RUNTIME_SUPPORT_REFRESH_MS\)/)
}

async function main(): Promise<void> {
  await pluginFiltering()
  aggregateSemantics()
  relativeTimeSemantics()
  await staticUiContract()
  console.log('Runtime Health UX 2.0 focused repro: PASS')
}

describe('runtime health', () => {
  it('reports explicit owned health and stale UI state', async () => {
    await main()
  })
})
