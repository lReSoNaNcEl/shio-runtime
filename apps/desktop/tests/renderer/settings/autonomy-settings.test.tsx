// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
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
    quietHours: { enabled: true, startHour: 22, endHour: 8 },
    cooldownMs: 15 * 60_000,
    maxDailyInitiatives: 6,
    fastBrain: { enabled: false, timeoutMs: 1_250, maxTokens: 64 },
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

describe('autonomy settings numeric fields', () => {
  it.each([
    {
      label: 'Начало тихих часов (0–23)',
      initial: '22',
      next: '23',
      expected: { quietHours: { enabled: true, startHour: 23, endHour: 8 } },
      confirmed: {
        ...snapshot.settings,
        quietHours: { ...snapshot.settings.quietHours, startHour: 23 },
      },
    },
    {
      label: 'Конец тихих часов (0–23)',
      initial: '8',
      next: '9',
      expected: { quietHours: { enabled: true, startHour: 22, endHour: 9 } },
      confirmed: {
        ...snapshot.settings,
        quietHours: { ...snapshot.settings.quietHours, endHour: 9 },
      },
    },
    {
      label: 'Пауза между инициативами, минут',
      initial: '15',
      next: '16',
      expected: { cooldownMs: 16 * 60_000 },
      confirmed: { ...snapshot.settings, cooldownMs: 16 * 60_000 },
    },
    {
      label: 'Лимит инициатив в день',
      initial: '6',
      next: '7',
      expected: { maxDailyInitiatives: 7 },
      confirmed: { ...snapshot.settings, maxDailyInitiatives: 7 },
    },
  ])('keeps $label visible while Main confirms the update', async (testCase) => {
    let confirmUpdate: ((value: AliveSnapshot) => void) | undefined
    const updateSettings = vi.fn(
      () =>
        new Promise<AliveSnapshot>((resolve) => {
          confirmUpdate = resolve
        }),
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { alive: { updateSettings } },
    })

    const view = render(<AutonomySettingsSection snapshot={snapshot} />, { wrapper: Wrapper })
    const field = view.getByRole('textbox', { name: testCase.label })

    expect(field).toHaveValue(testCase.initial)

    fireEvent.click(
      view.getByRole('button', {
        name: `Increase ${testCase.label}`,
      }),
    )

    expect(field).toHaveValue(testCase.next)
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining(testCase.expected))

    await act(async () => {
      confirmUpdate?.({
        ...snapshot,
        settings: testCase.confirmed,
      })
    })
  })

  it('restores the confirmed value when persistence fails', async () => {
    const updateSettings = vi.fn().mockRejectedValue(new Error('SAVE_FAILED'))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { alive: { updateSettings } },
    })

    const view = render(<AutonomySettingsSection snapshot={snapshot} />, { wrapper: Wrapper })
    const cooldown = view.getByRole('textbox', {
      name: 'Пауза между инициативами, минут',
    })

    fireEvent.click(
      view.getByRole('button', {
        name: 'Increase Пауза между инициативами, минут',
      }),
    )

    expect(cooldown).toHaveValue('16')
    await waitFor(() => expect(cooldown).toHaveValue('15'))
    expect(view.getByText('SAVE_FAILED')).toBeInTheDocument()
  })
})
