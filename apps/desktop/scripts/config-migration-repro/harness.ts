import assert from 'node:assert/strict'

import {
  DESKTOP_CONFIG_SCHEMA_VERSION,
  migrateLegacyDesktopSettings,
} from '../../src/shared/config'

for (const mode of ['silent', 'passive', 'active', 'streamer']) {
  const migrated = migrateLegacyDesktopSettings({
    continuousListeningMode: mode,
    continuousListeningEnabled: 'true',
    passiveCompanionEnabled: 'false',
    ttsVoice: 'legacy-user-voice',
    overlayViewMode: 'front',
    micDeviceId: 'saved-microphone',
    projectAwareness: { enabled: true, repository: '' },
  })
  assert.equal(migrated.configSchemaVersion, DESKTOP_CONFIG_SCHEMA_VERSION)
  assert.equal(migrated.uiTheme, 'light')
  assert.equal(migrated.overlayViewMode, 'bust')
  assert.equal('continuousListeningMode' in migrated, false)
  assert.equal('continuousListeningEnabled' in migrated, false)
  assert.equal('passiveCompanionEnabled' in migrated, false)
  assert.equal('ttsVoice' in migrated, false)
  assert.equal(migrated.micDeviceId, 'saved-microphone')
  assert.deepEqual(migrated.setup, { completed: false })
  assert.equal('projectAwareness' in migrated, false)
  assert.deepEqual(migrateLegacyDesktopSettings(migrated), migrated)
}

assert.equal(migrateLegacyDesktopSettings({ uiTheme: 'light' }).uiTheme, 'light')
assert.equal(migrateLegacyDesktopSettings({ uiTheme: 'dark' }).uiTheme, 'dark')
assert.equal(migrateLegacyDesktopSettings({ uiTheme: 'unknown' }).uiTheme, 'light')

console.log('config migration repro: passed')
