// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AutonomySettingsSection } from '../../../src/renderer/components/settings/sections/AutonomySettingsSection'
import { LocalizationContext } from '../../../src/renderer/localization/LocalizationProvider'
import type { AliveSnapshot } from '../../../src/shared/alive'
import { translate } from '../../../src/shared/localization'

const snapshot = {
  settings: {
    mode: 'full',
    globallySuspended: false,
    privacyMode: true,
  },
} as AliveSnapshot

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationContext.Provider
      value={{
        locale: 'ru',
        intlLocale: 'ru-RU',
        t: (key, params) => translate('ru', key, params),
      }}
    >
      {children}
    </LocalizationContext.Provider>
  )
}

const originalApi = Object.getOwnPropertyDescriptor(window, 'api')

afterEach(() => {
  cleanup()
  if (originalApi) Object.defineProperty(window, 'api', originalApi)
  else Reflect.deleteProperty(window, 'api')
})

describe('autonomy settings', () => {
  it('shows the autonomy and privacy controls and can pause autonomy', async () => {
    const updateSettings = vi.fn().mockResolvedValue(snapshot)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { alive: { updateSettings } },
    })

    const view = render(<AutonomySettingsSection snapshot={snapshot} />, { wrapper: Wrapper })
    expect(view.queryByRole('heading', { name: 'Время и ограничения' })).toBeNull()
    expect(view.getByRole('switch')).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: 'Приостановить' }))

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        ...snapshot.settings,
        globallySuspended: true,
      }),
    )
  })
})
