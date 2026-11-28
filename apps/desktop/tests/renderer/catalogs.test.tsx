// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PluginsView } from '../../src/renderer/components/plugins/PluginsView'
import { CapabilitiesView } from '../../src/renderer/components/views/CapabilitiesView'
import { MemoryView } from '../../src/renderer/components/views/MemoryView'
import type {
  ShioCapabilityDescriptor,
  ShioCapabilitySnapshot,
} from '../../src/shared/capabilities'
import { translate } from '../../src/shared/localization'
import type { MemoryRecord } from '../../src/shared/memory'
import type { PluginStatus } from '../../src/shared/plugins'
import { localizedWrapper, stubWindowProperty } from '../support/rendering'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))

// JSDOM has no layout observer. These tests exercise confirmation, not scrolling.
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    },
  )
})

let restoreApi: () => void = () => undefined
afterEach(() => {
  cleanup()
  restoreApi()
  vi.useRealTimers()
})
const t = (key: Parameters<typeof translate>[1]) => translate('en', key)

describe.each(['light', 'dark'] as const)('catalog behavior in %s theme', (theme) => {
  it('groups capabilities by category and filters visible entries that need attention', () => {
    const titles = [
      'app.nav.chat',
      'app.nav.plugins',
      'app.nav.settings',
      'app.nav.diagnostics',
      'app.nav.memory',
    ] as const
    const availability = [
      'available',
      'disabled',
      'needs-setup',
      'degraded',
      'unavailable',
    ] as const
    const capabilities: ShioCapabilityDescriptor[] = availability.map((state, index) => ({
      id: `fixture-${index}`,
      category: state === 'disabled' ? 'knowledge' : 'communication',
      source: { kind: 'core' },
      titleKey: titles[index],
      descriptionKey: 'capabilities.textChat.description',
      availability: state,
      authority: 'read-only',
      reasonKey: state === 'disabled' ? 'capabilities.reason.pluginDisabled' : undefined,
      navigationTarget:
        state === 'disabled'
          ? { kind: 'plugin', id: 'project-awareness' }
          : { kind: 'settings', id: state === 'degraded' ? 'autonomy' : 'llm' },
    }))
    const snapshot: ShioCapabilitySnapshot = {
      schemaVersion: 1,
      generatedAt: 1,
      capabilities: [
        ...capabilities,
        { ...capabilities[0], id: 'avatar-presence', titleKey: 'app.nav.avatar' },
        {
          ...capabilities[2],
          id: 'alive-autonomy',
          titleKey: 'capabilities.alive.title',
          authority: 'full',
        },
      ],
    }
    const onNavigate = vi.fn()
    const onRefresh = vi.fn()
    const view = (value: ShioCapabilitySnapshot) => (
      <CapabilitiesView
        snapshot={value}
        error={null}
        onRefresh={onRefresh}
        onNavigate={onNavigate}
      />
    )
    const { rerender } = render(view(snapshot), { wrapper: localizedWrapper('en', theme) })
    const visibleTitles = () =>
      screen.getAllByRole('article').map((row) => within(row).getByRole('heading').textContent)
    expect(visibleTitles()).toEqual([0, 2, 3, 4, 1].map((index) => t(titles[index])))
    expect(screen.queryByRole('heading', { name: t('app.nav.avatar') })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: t('capabilities.alive.title') }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(t('capabilities.authority.full'))).not.toBeInTheDocument()
    expect(screen.getAllByText(t('capabilities.authority.readOnly'))).toHaveLength(5)
    expect(screen.getByRole('radio', { name: 'All · 5' })).toBeChecked()

    const chat = screen.getAllByRole('article')[0]
    expect(within(chat).getByText(t('capabilities.availability.available'))).toBeInTheDocument()
    fireEvent.click(within(chat).getByRole('button', { name: 'Settings · AI — Chat' }))
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'settings', id: 'llm' })

    fireEvent.click(screen.getByRole('radio', { name: 'Needs attention · 4' }))
    expect(visibleTitles()).toEqual([2, 3, 4, 1].map((index) => t(titles[index])))
    expect(within(screen.getAllByRole('article')[1]).queryByRole('button')).not.toBeInTheDocument()
    const knowledge = within(screen.getByRole('region', { name: 'Knowledge' }))
    expect(knowledge.getByText(t('capabilities.availability.disabled'))).toBeInTheDocument()
    expect(knowledge.getByText(t('capabilities.reason.pluginDisabled'))).toBeInTheDocument()
    fireEvent.click(knowledge.getByRole('button', { name: 'Open plugin — Plugins' }))
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'plugin', id: 'project-awareness' })

    rerender(view({ ...snapshot, capabilities: [capabilities[0]] }))
    expect(screen.getByRole('radio', { name: 'Needs attention · 0' })).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent(t('capabilities.filter.emptyAttention'))
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'All · 1' }))
    expect(visibleTitles()).toEqual([t(titles[0])])
  })

  it('distinguishes direct and visual browser control in the same catalog', () => {
    const browser: ShioCapabilityDescriptor = {
      id: 'browser-control',
      category: 'action',
      source: { kind: 'plugin', pluginId: 'browser-control' },
      titleKey: 'capabilities.browser.title',
      descriptionKey: 'capabilities.browser.description',
      availability: 'available',
      navigationTarget: { kind: 'plugin', id: 'browser-control' },
    }
    const visual: ShioCapabilityDescriptor = {
      ...browser,
      id: 'browser-computer-use',
      titleKey: 'plugins.browserControl.name',
      descriptionKey: 'plugins.browserControl.description',
      details: {
        kind: 'browser-computer-use',
        semanticControl: 'ready',
        visualControl: 'ready',
        isolatedProfile: true,
      },
    }
    const navigate = vi.fn()
    render(
      <CapabilitiesView
        snapshot={{ schemaVersion: 1, generatedAt: 1, capabilities: [browser, visual] }}
        error={null}
        onRefresh={vi.fn()}
        onNavigate={navigate}
      />,
      { wrapper: localizedWrapper('ru', theme) },
    )
    expect(screen.getByRole('heading', { name: 'Управление браузером' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Визуальное управление браузером' }),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Открыть плагин — Визуальное управление браузером' }),
    )
    expect(navigate).toHaveBeenCalledWith({ kind: 'plugin', id: 'browser-control' })
  })

  it('shows disabled independently of health and delegates enable/disable to Main', async () => {
    let plugin: PluginStatus = {
      manifest: {
        id: 'project-awareness',
        version: '1',
        nameKey: 'plugins.projectAwareness.name',
        descriptionKey: 'plugins.projectAwareness.description',
        defaultEnabled: false,
        capabilities: ['project-context'],
      },
      enabled: false,
      lifecycle: 'disabled',
      health: { state: 'error', checkedAt: 1 },
      busy: false,
    }
    const enable = vi.fn(async () => {
      plugin = { ...plugin, enabled: true, lifecycle: 'active' }
      return plugin
    })
    const disable = vi.fn(async () => {
      plugin = { ...plugin, enabled: false, lifecycle: 'disabled' }
      return plugin
    })
    const clear = vi.spyOn(window, 'clearInterval')
    restoreApi = stubWindowProperty('api', {
      plugins: { list: vi.fn(async () => [plugin]), enable, disable },
    })
    const view = render(
      <PluginsView
        detailPluginId={null}
        onShowDetails={vi.fn()}
        onBack={vi.fn()}
        onOpenLlmSettings={vi.fn()}
      />,
      { wrapper: localizedWrapper('en', theme) },
    )
    const toggle = await screen.findByRole('switch', {
      name: translate('en', 'plugins.enableLabel', { plugin: t('plugins.projectAwareness.name') }),
    })
    const card = toggle.closest('article')
    if (!card) throw new Error('Plugin card missing')
    expect(within(card).getByText(t('common.disabled'))).toBeInTheDocument()
    expect(within(card).queryByText(t('plugins.health.error'))).not.toBeInTheDocument()
    fireEvent.click(toggle)
    await waitFor(() => expect(enable).toHaveBeenCalledWith('project-awareness'))
    await screen.findByText(t('plugins.health.error'))
    fireEvent.click(
      screen.getByRole('switch', {
        name: translate('en', 'plugins.disableLabel', {
          plugin: t('plugins.projectAwareness.name'),
        }),
      }),
    )
    await waitFor(() => expect(disable).toHaveBeenCalledWith('project-awareness'))
    await waitFor(() => expect(within(card).getByText(t('common.disabled'))).toBeInTheDocument())
    view.unmount()
    expect(clear).toHaveBeenCalled()
  })

  it('shows all explicit memory records in one list and searches across their categories', async () => {
    const records = [
      ['fact', 'I have a garden.'],
      ['decision', 'We chose the bridge route.'],
      ['commitment', 'We will revisit the bridge.'],
      ['relationship', 'We explored the bridge together.'],
    ] as const
    const items: MemoryRecord[] = records.map(([kind, text], index) => ({
      id: String(index),
      kind,
      text,
      source: { type: 'manual' },
      createdAt: '2026-11-21T09:00:00Z',
      updatedAt: '2026-11-21T09:00:00Z',
    }))
    const list = vi.fn(async () => ({ ok: true, data: { items } }))
    const search = vi.fn(async () => ({ ok: true, data: { items: items.slice(1) } }))
    restoreApi = stubWindowProperty('api', {
      memory: {
        getStatus: vi.fn(async () => ({
          ok: true,
          data: { enabled: true, operational: true, recordCount: items.length },
        })),
        list,
        search,
      },
    })
    render(<MemoryView />, { wrapper: localizedWrapper('en', theme) })

    await screen.findByText(items[0].text)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    for (const item of items) expect(screen.getByText(item.text)).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith({ limit: 50 })

    fireEvent.change(screen.getByRole('searchbox', { name: t('memory.search') }), {
      target: { value: 'bridge' },
    })
    await waitFor(() => expect(screen.queryByText(items[0].text)).not.toBeInTheDocument())
    expect(search).toHaveBeenCalledWith({ query: 'bridge', limit: 20 })
    for (const item of items.slice(1)) expect(screen.getByText(item.text)).toBeInTheDocument()
  })

  it('requires explicit confirmation before clearing semantic memory', async () => {
    const clearAll = vi.fn(async () => ({ ok: true, data: {} }))
    restoreApi = stubWindowProperty('api', {
      memory: {
        getStatus: vi.fn(async () => ({
          ok: true,
          data: { enabled: true, operational: true, recordCount: 1 },
        })),
        list: vi.fn(async () => ({ ok: true, data: { items: [] } })),
        clearAll,
      },
    })
    render(<MemoryView />, { wrapper: localizedWrapper('en', theme) })
    const more = await screen.findByRole('button', { name: t('memory.toolbar.more') })
    await waitFor(() => expect(more).toBeEnabled())
    fireEvent.click(more)
    fireEvent.click(await screen.findByRole('menuitem', { name: t('memory.clearAll') }))
    const dialog = await screen.findByRole('dialog', { name: t('memory.clearTitle') })
    expect(clearAll).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
    expect(clearAll).not.toHaveBeenCalled()
    fireEvent.click(more)
    fireEvent.click(await screen.findByRole('menuitem', { name: t('memory.clearAll') }))
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: t('memory.clearTitle') })).getByRole(
        'button',
        { name: t('memory.clearAll') },
      ),
    )
    await waitFor(() => expect(clearAll).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
