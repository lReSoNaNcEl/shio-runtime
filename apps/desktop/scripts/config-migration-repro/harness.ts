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
    overlayViewMode: 'front',
    micDeviceId: 'saved-microphone',
    projectAwareness: { enabled: true, repository: '' },
  })
  assert.equal(migrated.configSchemaVersion, DESKTOP_CONFIG_SCHEMA_VERSION)
  assert.equal(migrated.overlayViewMode, 'bust')
  assert.equal('continuousListeningMode' in migrated, false)
  assert.equal('continuousListeningEnabled' in migrated, false)
  assert.equal('passiveCompanionEnabled' in migrated, false)
  assert.equal(migrated.micDeviceId, 'saved-microphone')
  assert.deepEqual(migrated.setup, { completed: false })
  assert.equal((migrated.projectAwareness as { enabled: boolean }).enabled, false)
  assert.deepEqual(migrateLegacyDesktopSettings(migrated), migrated)
}

console.log('config migration repro: passed')
