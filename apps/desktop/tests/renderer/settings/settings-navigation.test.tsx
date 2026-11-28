// @vitest-environment jsdom

import { Provider } from '@react-spectrum/s2'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { SettingsNavigation } from '../../../src/renderer/components/settings/SettingsNavigation'
import { translate } from '../../../src/shared/localization'

afterEach(cleanup)

it.each([
  ['light', 'ru'],
  ['dark', 'ru'],
  ['light', 'en'],
  ['dark', 'en'],
] as const)('opens the five settings sections in %s / %s', (theme, locale) => {
  const sections = ['general', 'llm', 'speech', 'avatar', 'advanced'] as const
  const labels = {
    general: translate(locale, 'settings.section.general'),
    llm: translate(locale, 'settings.section.llm'),
    speech: translate(locale, 'settings.section.speech'),
    avatar: translate(locale, 'settings.section.avatar'),
    advanced: translate(locale, 'settings.section.advanced'),
  }
  const select = vi.fn()
  render(
    <Provider colorScheme={theme} locale={locale}>
      <SettingsNavigation
        activeSection="general"
        labels={labels}
        onSelect={select}
        ariaLabel={translate(locale, 'settings.tabsLabel')}
      />
    </Provider>,
  )
  expect(screen.getAllByRole('button')).toHaveLength(sections.length)
  for (const section of sections) {
    fireEvent.click(screen.getByRole('button', { name: labels[section] }))
    expect(select).toHaveBeenLastCalledWith(section)
  }
})
