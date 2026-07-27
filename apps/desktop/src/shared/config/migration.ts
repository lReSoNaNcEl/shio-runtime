export const DESKTOP_CONFIG_SCHEMA_VERSION = 2

export function migrateLegacyDesktopSettings(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const migrated = { ...input }
  delete migrated.continuousListeningMode
  delete migrated.continuousListeningEnabled
  delete migrated.passiveCompanionEnabled
  migrated.configSchemaVersion = DESKTOP_CONFIG_SCHEMA_VERSION
  migrated.overlayViewMode = input.overlayViewMode === 'front' ? 'bust' : input.overlayViewMode
  migrated.setup =
    input.setup && typeof input.setup === 'object'
      ? input.setup
      : {
          completed: false,
        }
  if (input.projectAwareness && typeof input.projectAwareness === 'object') {
    const project = input.projectAwareness as Record<string, unknown>
    migrated.projectAwareness = {
      ...project,
      enabled:
        project.enabled === true &&
        typeof project.repository === 'string' &&
        project.repository.trim().length > 0,
    }
  }
  return migrated
}
