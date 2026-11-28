// @vitest-environment jsdom

import { Provider } from '@react-spectrum/s2'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))

import { SpeechSettingsSection } from '../../../src/renderer/components/settings/sections/SpeechSettingsSection'
import { LocalizationContext } from '../../../src/renderer/localization/LocalizationProvider'
import { toIntlLocale, translate } from '../../../src/shared/localization'

afterEach(cleanup)

it.each([
  ['ru', 'light'],
  ['ru', 'dark'],
  ['en', 'light'],
  ['en', 'dark'],
] as const)(
  'keeps microphone and volume controls without a language picker in %s / %s',
  (locale, theme) => {
    const intlLocale = toIntlLocale(locale)
    render(
      <Provider colorScheme={theme} locale={intlLocale}>
        <LocalizationContext.Provider
          value={{ locale, intlLocale, t: (key, params) => translate(locale, key, params) }}
        >
          <SpeechSettingsSection
            state={{
              speechVolumePercent: 70,
              microphoneId: 'default',
              microphones: [{ deviceId: 'default', label: 'USB audio input' }],
              voiceWarmup: { state: 'idle', voiceId: '', language: '' },
              continuousListening: {
                desired: false,
                transport: 'off',
                activity: 'idle',
                microphoneCaptured: false,
              },
              microphoneTestState: 'idle',
              microphoneLevel: 0,
              microphoneTestFailure: null,
            }}
            actions={{
              setSpeechVolumePercent: vi.fn(),
              saveSpeechVolumePercent: vi.fn(),
              setMicrophoneId: vi.fn(),
              recordMicrophoneTest: vi.fn(),
              playMicrophoneTest: vi.fn(),
            }}
          />
        </LocalizationContext.Provider>
      </Provider>,
    )
    expect(screen.getByRole('slider')).toBeTruthy()
    expect(screen.getByText(translate(locale, 'settings.speech.microphone'))).toBeTruthy()
    expect(screen.queryByText(locale === 'ru' ? 'Язык TTS' : 'TTS language')).toBeNull()
  },
)
