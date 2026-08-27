import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pluginIdForNavigationTarget } from '../../src/renderer/components/navigation/capabilityNavigation'
import { aggregateHealth, pluginHealthSeverity } from '../../src/renderer/runtime/runtimeHealth'
import { PLUGIN_IDS, type RuntimePluginHealth } from '../../src/shared/plugins'

const desktopRoot = process.cwd().endsWith('apps\\desktop')
  ? process.cwd()
  : join(process.cwd(), 'apps', 'desktop')

function source(relativePath: string): Promise<string> {
  return readFile(join(desktopRoot, relativePath), 'utf8')
}

async function main(): Promise<void> {
  for (const pluginId of PLUGIN_IDS) {
    assert.equal(
      pluginIdForNavigationTarget({ kind: 'plugin', id: pluginId }),
      pluginId,
      `Capability navigation must retain exact Plugin id ${pluginId}`,
    )
  }
  assert.equal(pluginIdForNavigationTarget({ kind: 'plugin', id: 'unknown' }), undefined)

  const needsSetup = {
    enabled: true,
    lifecycle: 'active',
    health: { state: 'needs-setup', checkedAt: 1 },
  } as RuntimePluginHealth
  assert.equal(pluginHealthSeverity(needsSetup), 'healthy')
  assert.equal(
    aggregateHealth([
      { enabled: false, severity: 'error' },
      { enabled: true, severity: 'healthy' },
    ]),
    'healthy',
  )

  const [app, shell, status, listening, speechSettings, controller, asr, browserAdapter] =
    await Promise.all([
      source('src/renderer/components/App.tsx'),
      source('src/renderer/components/shell/AppShell.tsx'),
      source('src/renderer/components/shell/RuntimeStatusIndicator.tsx'),
      source('src/renderer/components/controls/ListeningControl.tsx'),
      source('src/renderer/components/settings/sections/SpeechSettingsSection.tsx'),
      source('src/renderer/controller/contracts.ts'),
      source('src/renderer/speech/continuous-listening/StreamingAsrClient.ts'),
      source('src/main/browser-control/playwright/PlaywrightBrowserAdapter.ts'),
    ])
  assert.doesNotMatch(app, /PROJECT_AWARENESS_PLUGIN_ID|DESKTOP_CONTROL_PLUGIN_ID/)
  assert.match(app, /pluginIdForNavigationTarget/)
  assert.match(app, /const refreshOverlayVisibility = useCallback/)
  assert.match(app, /onOverlayVisibleChange=\{refreshOverlayVisibility\}/)
  assert.doesNotMatch(app, /onOverlayVisibleChange=\{\(\) =>/)
  assert.doesNotMatch(shell, /id: 'health'|onSectionChange\('health'\)/)
  assert.match(status, /<Popover/)
  assert.match(status, /copyReport/)
  assert.match(listening, /ToggleButton/)
  assert.doesNotMatch(listening, /isDisabled=\{projection\.transport === 'starting'/)
  assert.doesNotMatch(speechSettings, /<Switch/)
  assert.match(speechSettings, /microphoneCaptured/)
  assert.match(controller, /continuousListening: ContinuousListeningProjection/)
  assert.doesNotMatch(controller, /continuousListeningEnabled|continuousListeningState/)
  assert.match(asr, /asrStreamEventSchema/)
  assert.match(asr, /ASR_STREAM_MAX_JSON_MESSAGE_CHARS/)

  for (const moduleName of [
    'PlaywrightBrowserLifecycle',
    'PlaywrightPageRegistry',
    'PlaywrightSemanticObserver',
    'PlaywrightComputerUseObserver',
    'PlaywrightInputController',
    'PlaywrightBlockerPolicy',
    'PlaywrightRefRegistry',
  ]) {
    await access(join(desktopRoot, `src/main/browser-control/playwright/${moduleName}.ts`))
  }
  assert.match(browserAdapter, /PlaywrightInputController/)
  assert.match(browserAdapter, /capturePlaywrightComputerUseObservation/)
  await assert.rejects(
    access(join(desktopRoot, 'src/renderer/components/views/RuntimeHealthView.tsx')),
  )

  console.log('Stability hardening cross-domain repro: PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
