import { describe, expect, it } from 'vitest'

import { DEFAULT_SPEECH_API_URL, resolveEnvironmentConfig } from '../../src/main/environmentConfig'
import {
  DESKTOP_CONFIG_SCHEMA_VERSION,
  migrateLegacyDesktopSettings,
} from '../../src/shared/config'

describe('Desktop configuration migration', () => {
  it.each(['silent', 'passive', 'active', 'streamer'])(
    'removes legacy %s listening settings without changing retained user choices',
    (mode) => {
      const migrated = migrateLegacyDesktopSettings({
        continuousListeningMode: mode,
        continuousListeningEnabled: 'true',
        passiveCompanionEnabled: 'false',
        ttsVoice: 'legacy-user-voice',
        pythonSpeechUrl: 'http://old-user-endpoint.invalid:9000',
        overlayViewMode: 'front',
        micDeviceId: 'saved-microphone',
        projectAwareness: { enabled: true, repository: '' },
      })

      expect(migrated.configSchemaVersion).toBe(DESKTOP_CONFIG_SCHEMA_VERSION)
      expect(migrated.uiTheme).toBe('light')
      expect(migrated.overlayViewMode).toBe('bust')
      expect(migrated).not.toHaveProperty('continuousListeningMode')
      expect(migrated).not.toHaveProperty('continuousListeningEnabled')
      expect(migrated).not.toHaveProperty('passiveCompanionEnabled')
      expect(migrated).not.toHaveProperty('ttsVoice')
      expect(migrated).not.toHaveProperty('pythonSpeechUrl')
      expect(migrated.micDeviceId).toBe('saved-microphone')
      expect(migrated.setup).toEqual({ completed: false })
      expect(migrated).not.toHaveProperty('projectAwareness')
      expect(migrateLegacyDesktopSettings(migrated)).toEqual(migrated)
    },
  )

  it('normalizes unsupported theme values', () => {
    expect(migrateLegacyDesktopSettings({ uiTheme: 'light' }).uiTheme).toBe('light')
    expect(migrateLegacyDesktopSettings({ uiTheme: 'dark' }).uiTheme).toBe('dark')
    expect(migrateLegacyDesktopSettings({ uiTheme: 'unknown' }).uiTheme).toBe('light')
  })

  it('keeps the speech endpoint Main-owned environment configuration', () => {
    expect(resolveEnvironmentConfig({}).speechApiUrl).toBe(DEFAULT_SPEECH_API_URL)
    expect(
      resolveEnvironmentConfig({ SHIO_SPEECH_API_URL: 'http://127.0.0.1:9000/' }).speechApiUrl,
    ).toBe('http://127.0.0.1:9000')
    expect(
      resolveEnvironmentConfig({ PYTHON_SPEECH_URL: 'http://legacy.invalid:9000' }).speechApiUrl,
    ).toBe(DEFAULT_SPEECH_API_URL)
    expect(() =>
      resolveEnvironmentConfig({ SHIO_SPEECH_API_URL: 'file:///not-a-speech-service' }),
    ).toThrow(/http or https/)
  })
})
