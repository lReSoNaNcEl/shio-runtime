import { describe, expect, it } from 'vitest'

import { createChatQuickActions } from '../../../src/renderer/components/chat/chatQuickActions'
import type { ShioCapabilitySnapshot } from '../../../src/shared/capabilities'
import { type TranslationKey, translate } from '../../../src/shared/localization'

const translateKey = (key: TranslationKey): string => key

describe('chat quick actions', () => {
  it('shows tool prompts only for capabilities available in the canonical snapshot', () => {
    const snapshot: ShioCapabilitySnapshot = {
      schemaVersion: 1,
      generatedAt: 1,
      capabilities: [
        {
          id: 'web-search',
          category: 'knowledge',
          source: { kind: 'plugin', pluginId: 'web-search' },
          titleKey: 'capabilities.webSearch.title',
          descriptionKey: 'capabilities.webSearch.description',
          availability: 'available',
        },
        {
          id: 'project-awareness',
          category: 'knowledge',
          source: { kind: 'plugin', pluginId: 'project-awareness' },
          titleKey: 'plugins.projectAwareness.name',
          descriptionKey: 'capabilities.project.description',
          availability: 'available',
        },
        {
          id: 'screen-understanding',
          category: 'perception',
          source: { kind: 'core' },
          titleKey: 'capabilities.screen.title',
          descriptionKey: 'capabilities.screen.description',
          availability: 'available',
        },
        {
          id: 'computer-control',
          category: 'action',
          source: { kind: 'plugin', pluginId: 'desktop-control' },
          titleKey: 'capabilities.computer.title',
          descriptionKey: 'capabilities.computer.description',
          availability: 'available',
        },
        {
          id: 'long-term-memory',
          category: 'knowledge',
          source: { kind: 'core' },
          titleKey: 'capabilities.memory.title',
          descriptionKey: 'capabilities.memory.description',
          availability: 'available',
        },
        {
          id: 'browser-control',
          category: 'action',
          source: { kind: 'plugin', pluginId: 'browser-control' },
          titleKey: 'capabilities.browser.title',
          descriptionKey: 'capabilities.browser.description',
          availability: 'available',
          authority: 'confirm',
        },
        {
          id: 'browser-computer-use',
          category: 'action',
          source: { kind: 'plugin', pluginId: 'browser-control' },
          titleKey: 'plugins.browserControl.name',
          descriptionKey: 'plugins.browserControl.description',
          availability: 'available',
          authority: 'confirm',
        },
        {
          id: 'alive-autonomy',
          category: 'action',
          source: { kind: 'core' },
          titleKey: 'capabilities.alive.title',
          descriptionKey: 'capabilities.alive.description',
          availability: 'available',
        },
      ],
    }

    const actions = createChatQuickActions(snapshot, translateKey)

    expect(actions.starter.map((action) => action.id)).toEqual(['greet', 'joke', 'capabilities'])
    expect(actions.tools.map((action) => action.id)).toEqual([
      'web-search',
      'project-awareness',
      'project-desktop-packages',
      'screen-understanding',
      'long-term-memory',
      'alive-autonomy',
      'browser-control',
      'browser-computer-use',
      'computer-control',
    ])
    expect(actions.tools.find((action) => action.id === 'screen-understanding')?.effect).toBe(
      'prepare-screen-context',
    )

    const localizedActions = createChatQuickActions(snapshot, (key) => translate('ru', key))
    const screenPrompt = localizedActions.tools.find(
      (action) => action.id === 'screen-understanding',
    )
    expect(screenPrompt?.prompt).toContain('только приложенный')
    expect(screenPrompt?.prompt).toContain('Не открывай и не используй браузер')
    const memoryPrompt = localizedActions.tools.find((action) => action.id === 'long-term-memory')
    expect(memoryPrompt?.prompt).toContain('memory.list')
    expect(memoryPrompt?.prompt).toContain('{"limit":20}')
    expect(memoryPrompt?.prompt).not.toContain('"kind"')
    const goalPrompt = localizedActions.tools.find((action) => action.id === 'alive-autonomy')
    expect(goalPrompt?.prompt).toContain('goal.list')
    expect(goalPrompt?.prompt).toContain('{"status":"active","limit":20}')
    const projectPackagesPrompt = localizedActions.tools.find(
      (action) => action.id === 'project-desktop-packages',
    )
    expect(projectPackagesPrompt?.prompt).toContain('project.search')
    expect(projectPackagesPrompt?.prompt).toContain(
      '{"query":"Какие пакеты @deepseek-ai перечислены в dependencies файла apps/desktop/package.json?","hints":{"paths":["apps/desktop/package.json"]}}',
    )
    expect(projectPackagesPrompt?.prompt).toContain('Не отвечай по памяти')
    const browserPrompt = localizedActions.tools.find((action) => action.id === 'browser-control')
    expect(browserPrompt?.prompt).toContain('browser.open')
    expect(browserPrompt?.prompt).toContain('{"url":"https://example.com"}')
    expect(browserPrompt?.prompt).toContain('свежего observation')
    expect(browserPrompt?.prompt).toContain('Не вызывай browser.use или browser.useStatus')
    const visualBrowserPrompt = localizedActions.tools.find(
      (action) => action.id === 'browser-computer-use',
    )
    expect(visualBrowserPrompt?.prompt).toContain('browser.use')
    expect(visualBrowserPrompt?.prompt).toContain(
      '{"goal":"Открой https://example.com, прочитай заголовок страницы и заверши задачу","termination":{"type":"goal-completed"}}',
    )
    expect(visualBrowserPrompt?.prompt).toContain('browser.useStatus')
    expect(visualBrowserPrompt?.prompt).toContain('{"waitForTerminalMs":15000}')
    expect(visualBrowserPrompt?.prompt).toContain('не запускай browser.use повторно')
    const shellPrompt = localizedActions.tools.find((action) => action.id === 'computer-control')
    expect(shellPrompt?.prompt).toContain('shell.execute')
    expect(shellPrompt?.prompt).toContain('Get-Host | Select-Object -ExpandProperty Version')
    expect(shellPrompt?.prompt).not.toContain('$PSVersionTable')
    expect(shellPrompt?.prompt).not.toContain('Get-Variable PSVersionTable')
    expect(shellPrompt?.prompt).not.toContain('Ничего не изменяй')
  })

  it('does not infer tool availability before a capability snapshot exists', () => {
    expect(createChatQuickActions(null, translateKey).tools).toEqual([])
  })
})
