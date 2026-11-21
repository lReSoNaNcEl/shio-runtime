// @vitest-environment jsdom

import { Provider } from '@react-spectrum/s2'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))

import { CharacterFallbackSettings } from '../../../src/renderer/components/settings/sections/CharacterFallbackSettings'
import type { LlmSettingsState } from '../../../src/renderer/components/settings/state/settingsContracts'
import { LocalizationContext } from '../../../src/renderer/localization/LocalizationProvider'
import { type FetchModelsResult, LLM_PROVIDER_IDS, type ModelInfo } from '../../../src/shared/llm'
import { translate, type UiLocale } from '../../../src/shared/localization'
import { createDeferred } from '../../support/Deferred'

const model: ModelInfo = {
  id: 'catalog-model',
  capabilities: {
    supportsImageGeneration: false,
    supportsVision: false,
    supportsReasoning: false,
    supportsStreaming: true,
    supportsToolCalling: true,
  },
}

function fixture() {
  const state: Pick<LlmSettingsState, 'providers' | 'providerSettings' | 'characterFallbacks'> = {
    providers: LLM_PROVIDER_IDS.map((id) => ({
      id,
      displayName: id,
      requiresApiKey: id !== 'codex-cli',
      modelsRequireApiKey: id !== 'codex-cli' && id !== 'openrouter',
      requiresAccountId: id === 'cloudflare',
      schemaCapabilities: { oneOf: false },
    })),
    providerSettings: Object.fromEntries(
      LLM_PROVIDER_IDS.map((id) => [
        id,
        {
          model: 'primary-is-unchanged',
          credential: { configured: true, source: 'secure_store', secureStorageAvailable: true },
        },
      ]),
    ) as LlmSettingsState['providerSettings'],
    characterFallbacks: [{ providerId: 'groq', model: 'saved-model' }],
  }
  const actions = { setCharacterFallbacks: vi.fn(), setCodexReasoningEffort: vi.fn() }
  const fetchModels = vi.fn<Window['api']['llm']['fetchModels']>(async () => ({
    ok: true,
    models: [model],
  }))
  vi.stubGlobal('api', { llm: { fetchModels } })
  return { state, actions, fetchModels }
}

function Wrapper({
  children,
  theme = 'light',
  locale = 'ru',
}: {
  children: ReactNode
  theme?: 'light' | 'dark'
  locale?: UiLocale
}) {
  const intlLocale = locale === 'ru' ? 'ru-RU' : 'en-US'
  return (
    <Provider colorScheme={theme} locale={intlLocale}>
      <LocalizationContext.Provider
        value={{ locale, intlLocale, t: (key, params) => translate(locale, key, params) }}
      >
        {children}
      </LocalizationContext.Provider>
    </Provider>
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Character fallback catalog', () => {
  it.each([
    ['light', 'ru'],
    ['dark', 'ru'],
    ['light', 'en'],
    ['dark', 'en'],
  ] as const)(
    'selects from the catalog in %s / %s without replacing the primary',
    async (theme, locale) => {
      const { state, actions, fetchModels } = fixture()
      render(
        <Wrapper theme={theme} locale={locale}>
          <CharacterFallbackSettings state={state} actions={actions} />
        </Wrapper>,
      )
      const input = screen.getByRole('combobox', { name: translate(locale, 'common.model') })
      await waitFor(() => expect(input).toBeEnabled())
      expect(fetchModels).toHaveBeenCalledExactlyOnceWith('groq', '')
      expect(input).toHaveValue('saved-model')
      expect(actions.setCharacterFallbacks).not.toHaveBeenCalled()
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      await waitFor(() => expect(screen.getByText('catalog-model')).toBeInTheDocument())
      fireEvent.click(screen.getByText('catalog-model'))
      const update = actions.setCharacterFallbacks.mock.calls.at(-1)?.[0]
      expect(update(state.characterFallbacks)).toEqual([
        { providerId: 'groq', model: 'catalog-model' },
      ])
      expect(state.providerSettings.groq.model).toBe('primary-is-unchanged')
    },
  )

  it('ignores a late catalog from the previous fallback provider', async () => {
    const { state, actions, fetchModels } = fixture()
    const late = createDeferred<FetchModelsResult>()
    fetchModels.mockImplementation((provider) =>
      provider === 'groq' ? late.promise : Promise.resolve({ ok: true, models: [model] }),
    )
    const view = render(<CharacterFallbackSettings state={state} actions={actions} />, {
      wrapper: Wrapper,
    })
    view.rerender(
      <CharacterFallbackSettings
        state={{ ...state, characterFallbacks: [{ providerId: 'mistral', model: '' }] }}
        actions={actions}
      />,
    )
    const input = screen.getByRole('combobox', { name: translate('ru', 'common.model') })
    await waitFor(() => expect(input).toBeEnabled())
    await act(async () => late.resolve({ ok: true, models: [{ ...model, id: 'stale-model' }] }))
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByText('catalog-model')).toBeInTheDocument())
    expect(screen.queryByText('stale-model')).not.toBeInTheDocument()
    expect(actions.setCharacterFallbacks).not.toHaveBeenCalled()
  })

  it('shows a failed catalog honestly and supports retry', async () => {
    const { state, actions, fetchModels } = fixture()
    fetchModels.mockRejectedValueOnce(new Error('offline'))
    render(<CharacterFallbackSettings state={state} actions={actions} />, { wrapper: Wrapper })
    await waitFor(() =>
      expect(
        screen.getByText(translate('ru', 'settings.llm.modelsNetworkError')),
      ).toBeInTheDocument(),
    )
    fireEvent.click(
      screen.getByRole('button', { name: translate('ru', 'settings.llm.loadModels') }),
    )
    await waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: translate('ru', 'common.model') })).toBeEnabled(),
    )
  })

  it('does not query a private catalog without its credential', async () => {
    const { state, actions, fetchModels } = fixture()
    state.providerSettings.groq.credential.configured = false
    render(<CharacterFallbackSettings state={state} actions={actions} />, { wrapper: Wrapper })
    await waitFor(() =>
      expect(
        screen.getByText(translate('ru', 'settings.llm.modelsMissingKey')),
      ).toBeInTheDocument(),
    )
    expect(fetchModels).not.toHaveBeenCalled()
  })

  it.each(['openrouter', 'codex-cli'] as const)(
    'loads the %s catalog without an API key and shows only the applicable credential warning',
    async (providerId) => {
      const { state, actions, fetchModels } = fixture()
      state.characterFallbacks = [{ providerId, model: '' }]
      state.providerSettings[providerId].credential.configured = false
      render(<CharacterFallbackSettings state={state} actions={actions} />, { wrapper: Wrapper })
      await waitFor(() =>
        expect(
          screen.getByRole('combobox', { name: translate('ru', 'common.model') }),
        ).toBeEnabled(),
      )
      expect(fetchModels).toHaveBeenCalledExactlyOnceWith(providerId, '')
      expect(screen.queryByText(translate('ru', 'settings.llm.fallback.keyMissing')) !== null).toBe(
        providerId === 'openrouter',
      )
      expect(
        screen.queryByText(translate('ru', 'settings.llm.modelsMissingKey')),
      ).not.toBeInTheDocument()
    },
  )

  it('waits for a valid Cloudflare account and requests its catalog', async () => {
    const { state, actions, fetchModels } = fixture()
    state.characterFallbacks = [{ providerId: 'cloudflare', model: '' }]
    const view = render(<CharacterFallbackSettings state={state} actions={actions} />, {
      wrapper: Wrapper,
    })
    expect(
      await screen.findByText(translate('ru', 'settings.llm.modelsMissingAccountId')),
    ).toBeInTheDocument()
    expect(fetchModels).not.toHaveBeenCalled()
    const accountId = 'a'.repeat(32)
    view.rerender(
      <CharacterFallbackSettings
        state={{
          ...state,
          providerSettings: {
            ...state.providerSettings,
            cloudflare: { ...state.providerSettings.cloudflare, accountId },
          },
        }}
        actions={actions}
      />,
    )
    await waitFor(() =>
      expect(fetchModels).toHaveBeenCalledExactlyOnceWith('cloudflare', accountId),
    )
  })
})
