// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppShell, SectionHeading } from '../../src/renderer/components/shell/AppShell'
import { RuntimeStatusIndicator } from '../../src/renderer/components/shell/RuntimeStatusIndicator'
import type { RuntimeHealthProjection } from '../../src/renderer/runtime/runtimeHealth'
import { translate } from '../../src/shared/localization'
import { localizedWrapper, stubWindowProperty } from '../support/rendering'

let restoreApi: () => void = () => undefined
afterEach(() => {
  cleanup()
  restoreApi()
})
const t = (key: Parameters<typeof translate>[1]) => translate('en', key)
const projection: RuntimeHealthProjection = {
  overall: 'healthy',
  components: [],
  plugins: [],
  recentIncidents: [],
  lastCheckedAt: null,
}
const actions = () => ({
  openDiagnostics: vi.fn(),
  openSpeechSettings: vi.fn(),
  openLlmSettings: vi.fn(),
  openPlugin: vi.fn(),
  copyReport: vi.fn(async () => undefined),
})

describe.each(['light', 'dark'] as const)('app shell in %s theme', (theme) => {
  it('contains its page in main, exposes navigation, and opens the creator via Main', async () => {
    const openExternalLink = vi.fn(async () => ({ ok: true }))
    restoreApi = stubWindowProperty('api', {
      system: { getReleaseInfo: async () => ({ version: '0.1.0-test' }), openExternalLink },
    })
    const onSectionChange = vi.fn()
    render(
      <AppShell
        section="chat"
        onSectionChange={onSectionChange}
        health={{ state: 'healthy', text: 'Healthy' }}
        runtimeHealth={projection}
        systemStatusActions={actions()}
        developerModeEnabled={false}
        heading={<SectionHeading title="Conversation" />}
        sidebarAction={<span>New conversation</span>}
      >
        <section aria-label="Conversation content">Messages</section>
      </AppShell>,
      { wrapper: localizedWrapper('en', theme) },
    )
    expect(
      within(screen.getByRole('main')).getByRole('region', { name: 'Conversation content' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Conversation' })).toBeInTheDocument()
    const navigation = screen.getByRole('navigation')
    expect(within(navigation).getByText('New conversation')).toBeInTheDocument()
    fireEvent.click(within(navigation).getByRole('button', { name: t('app.nav.plugins') }))
    expect(onSectionChange).toHaveBeenCalledWith('plugins')
    fireEvent.click(within(navigation).getByRole('button', { name: t('app.nav.capabilities') }))
    expect(onSectionChange).toHaveBeenCalledWith('capabilities')
    fireEvent.click(screen.getByRole('button', { name: t('app.creator.label') }))
    expect(openExternalLink).toHaveBeenCalledWith('https://t.me/IReSoNaNcEI')
    await waitFor(() => expect(screen.getByText('v0.1.0-test')).toBeInTheDocument())
  })

  it('opens runtime issues in a popover and copies the diagnostic report', async () => {
    const controls = actions()
    render(
      <RuntimeStatusIndicator
        health={{ state: 'error', text: 'Needs attention' }}
        projection={{
          ...projection,
          overall: 'error',
          components: [
            {
              id: 'speech',
              category: 'core',
              enabled: true,
              severity: 'error',
              titleKey: 'health.speech.title',
              summaryKey: 'health.speech.connectionFailed',
            },
          ],
        }}
        actions={controls}
      />,
      { wrapper: localizedWrapper('en', theme) },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }))
    expect(
      await screen.findByRole('heading', { name: t('systemStatus.title') }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('health.support.copyReport') }))
    await waitFor(() => expect(controls.copyReport).toHaveBeenCalledOnce())
  })
})
