// @vitest-environment jsdom

import { Provider } from '@react-spectrum/s2'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))

import { AdvancedSettingsSection } from '../../../src/renderer/components/settings/sections/AdvancedSettingsSection'
import { LocalizationContext } from '../../../src/renderer/localization/LocalizationProvider'
import { translate } from '../../../src/shared/localization'

afterEach(cleanup)

it.each([
  ['light', 'ru'],
  ['dark', 'ru'],
  ['light', 'en'],
  ['dark', 'en'],
] as const)(
  'shows the developer settings without the retired model in %s / %s',
  (theme, locale) => {
    const intlLocale = locale === 'ru' ? 'ru-RU' : 'en-US'
    render(
      <Provider colorScheme={theme} locale={intlLocale}>
        <LocalizationContext.Provider
          value={{ locale, intlLocale, t: (key, params) => translate(locale, key, params) }}
        >
          <AdvancedSettingsSection
            state={{ developerModeEnabled: true, developerOverlayAnimationHudEnabled: false }}
            actions={{
              setDeveloperModeEnabled: vi.fn(),
              setDeveloperOverlayAnimationHudEnabled: vi.fn(),
            }}
          />
        </LocalizationContext.Provider>
      </Provider>,
    )

    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual([
      translate(locale, 'settings.developerTools.title'),
      translate(locale, 'settings.developerRuntime.title'),
    ])
  },
)
