export const DESKTOP_CONFIG_SCHEMA_VERSION = 6

export function migrateLegacyDesktopSettings(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const migrated = { ...input }
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
  migrated.setup =
    input.setup && typeof input.setup === 'object'
      ? input.setup
      : {
          completed: false,
        }
  delete migrated.projectAwareness
  return migrated
}
