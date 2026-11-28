import { isUiLocale } from '../localization/locale'
import { DEFAULT_OVERLAY_HEIGHT, DEFAULT_OVERLAY_WIDTH } from './appSettings'

export const DESKTOP_CONFIG_SCHEMA_VERSION = 10

export function migrateLegacyDesktopSettings(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const migrated = { ...input }
  const savedLanguage = migrated.legacySpeechLanguage ?? migrated.ttsLanguage
  if (isUiLocale(savedLanguage)) migrated.legacySpeechLanguage = savedLanguage
  else delete migrated.legacySpeechLanguage
  delete migrated.ttsLanguage
  delete migrated.continuousListeningMode
  delete migrated.continuousListeningEnabled
  delete migrated.passiveCompanionEnabled
  // Voice selection is product-internal. Preserve no user-selectable value
  // during migration; runtime uses its stable internal default instead.
  delete migrated.ttsVoice
  // Speech endpoint ownership moved to immutable Main environment configuration.
  delete migrated.pythonSpeechUrl
  migrated.configSchemaVersion = DESKTOP_CONFIG_SCHEMA_VERSION
  migrated.uiTheme = input.uiTheme === 'dark' ? 'dark' : 'light'
  migrated.overlayViewMode = input.overlayViewMode === 'front' ? 'bust' : input.overlayViewMode
  if (
    (typeof input.configSchemaVersion !== 'number' || input.configSchemaVersion < 9) &&
    input.overlayWidth === '360' &&
    input.overlayHeight === '560'
  ) {
    migrated.overlayWidth = String(DEFAULT_OVERLAY_WIDTH)
    migrated.overlayHeight = String(DEFAULT_OVERLAY_HEIGHT)
  }
  migrated.setup =
    input.setup && typeof input.setup === 'object'
      ? input.setup
      : {
          completed: false,
        }
  delete migrated.projectAwareness
  return migrated
}
