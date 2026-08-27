import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseFile, walk } from '../support/architecture/sourceAst'
import { sourceRoot } from './context'

function syntaxNames(relativePath: string): Set<string> {
  const names = new Set<string>()
  walk(parseFile(join(sourceRoot, ...relativePath.split('/'))), (node) => {
    if (
      (node.type === 'Identifier' || node.type === 'JSXIdentifier') &&
      typeof node.name === 'string'
    ) {
      names.add(node.name)
    }
  })
  return names
}

describe('Renderer structural stability', () => {
  it('routes Plugin navigation through the canonical navigation helper', () => {
    const names = syntaxNames('renderer/components/App.tsx')
    expect(names).toContain('pluginIdForNavigationTarget')
    expect(names).not.toContain('PROJECT_AWARENESS_PLUGIN_ID')
    expect(names).not.toContain('DESKTOP_CONTROL_PLUGIN_ID')
  })

  it('retains the stable overlay refresh callback boundary', () => {
    const names = syntaxNames('renderer/components/App.tsx')
    expect(names).toContain('refreshOverlayVisibility')
    expect(names).toContain('onOverlayVisibleChange')
    expect(names).toContain('useCallback')
  })

  it('keeps Runtime Health in the shell status popover', () => {
    const shellNames = syntaxNames('renderer/components/shell/AppShell.tsx')
    const statusNames = syntaxNames('renderer/components/shell/RuntimeStatusIndicator.tsx')
    expect(shellNames).not.toContain('RuntimeHealthView')
    expect(statusNames).toContain('Popover')
    expect(statusNames).toContain('copyReport')
    expect(
      existsSync(join(sourceRoot, 'renderer', 'components', 'views', 'RuntimeHealthView.tsx')),
    ).toBe(false)
  })

  it('keeps continuous listening on canonical typed projections and Spectrum controls', () => {
    const listening = syntaxNames('renderer/components/controls/ListeningControl.tsx')
    const settings = syntaxNames('renderer/components/settings/sections/SpeechSettingsSection.tsx')
    const controller = syntaxNames('renderer/controller/contracts.ts')
    const asr = syntaxNames('renderer/speech/continuous-listening/StreamingAsrClient.ts')
    expect(listening).toContain('ToggleButton')
    expect(settings).toContain('microphoneCaptured')
    expect(settings).not.toContain('Switch')
    expect(controller).toContain('ContinuousListeningProjection')
    expect(controller).toContain('continuousListening')
    expect(controller).not.toContain('continuousListeningEnabled')
    expect(controller).not.toContain('continuousListeningState')
    expect(asr).toContain('asrStreamEventSchema')
    expect(asr).toContain('ASR_STREAM_MAX_JSON_MESSAGE_CHARS')
  })

  it('keeps Playwright concerns decomposed behind the Browser adapter', () => {
    const adapter = syntaxNames('main/browser-control/playwright/PlaywrightBrowserAdapter.ts')
    for (const owner of [
      'PlaywrightBrowserLifecycle',
      'PlaywrightPageRegistry',
      'PlaywrightSemanticObserver',
      'PlaywrightComputerUseObserver',
      'PlaywrightInputController',
      'PlaywrightBlockerPolicy',
      'PlaywrightRefRegistry',
    ]) {
      expect(
        existsSync(join(sourceRoot, 'main', 'browser-control', 'playwright', `${owner}.ts`)),
      ).toBe(true)
    }
    expect(adapter).toContain('PlaywrightInputController')
    expect(adapter).toContain('capturePlaywrightComputerUseObservation')
  })
})
