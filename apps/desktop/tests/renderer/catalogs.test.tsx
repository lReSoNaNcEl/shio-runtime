// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PluginsView } from '../../src/renderer/components/plugins/PluginsView'
import { CapabilitiesView } from '../../src/renderer/components/views/CapabilitiesView'
import { MemoryView } from '../../src/renderer/components/views/MemoryView'
import type {
  ShioCapabilityDescriptor,
  ShioCapabilitySnapshot,
} from '../../src/shared/capabilities'
import { translate } from '../../src/shared/localization'
import type { PluginStatus } from '../../src/shared/plugins'
import { localizedWrapper, stubWindowProperty } from '../support/rendering'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))

let restoreApi: () => void = () => undefined
afterEach(() => {
  cleanup()
  restoreApi()
  vi.useRealTimers()
})
const t = (key: Parameters<typeof translate>[1]) => translate('en', key)

describe.each(['light', 'dark'] as const)('catalog behavior in %s theme', (theme) => {
  it('filters canonical capability availability, hides avatar presence and preserves read-only authority', () => {
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
      category: 'communication',
      source: { kind: 'core' },
      titleKey: titles[index],
      descriptionKey: 'capabilities.catalog.description',
      availability: state,
      authority: 'read-only',
      navigationTarget: { kind: 'settings', id: 'llm' },
    }))
    const snapshot: ShioCapabilitySnapshot = {
      schemaVersion: 1,
      generatedAt: 1,
      capabilities: [
        ...capabilities,
        { ...capabilities[0], id: 'avatar-presence', titleKey: 'app.nav.avatar' },
      ],
    }
    const onNavigate = vi.fn()
    render(
      <CapabilitiesView
        snapshot={snapshot}
        error={null}
        onRefresh={vi.fn()}
        onNavigate={onNavigate}
      />,
      { wrapper: localizedWrapper('en', theme) },
    )
    expect(screen.getAllByRole('article')).toHaveLength(5)
    expect(screen.queryByRole('heading', { name: t('app.nav.avatar') })).not.toBeInTheDocument()
    expect(screen.getAllByText(t('capabilities.authority.readOnly'))).toHaveLength(5)
    for (const [key, expected] of [
      ['available', [0]],
      ['setup', [1, 2]],
      ['problems', [3, 4]],
    ] as const) {
      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(t(`capabilities.filter.${key}`)) }),
      )
      const cards = screen.getAllByRole('article')
      expect(cards).toHaveLength(expected.length)
      for (const index of expected)
        expect(screen.getByRole('heading', { name: t(titles[index]) })).toBeInTheDocument()
    }
    fireEvent.click(within(screen.getAllByRole('article')[0]).getByRole('button'))
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'settings', id: 'llm' })
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
    render(<MemoryView aliveSnapshot={null} />, { wrapper: localizedWrapper('en', theme) })
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
