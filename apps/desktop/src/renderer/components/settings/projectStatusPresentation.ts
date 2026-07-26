import type { TranslationKey } from '../../../shared/localization'
import type {
  ProjectAwarenessState,
  ProjectCredentialStatus,
} from '../../../shared/project-awareness'

export const connectionStatusKey: Record<ProjectAwarenessState, TranslationKey> = {
  disconnected: 'settings.project.connection.disconnected',
  connecting: 'settings.project.connection.connecting',
  ready: 'settings.project.connection.ready',
  syncing: 'settings.project.connection.syncing',
  indexing: 'settings.project.connection.indexing',
  stale: 'settings.project.connection.stale',
  error: 'settings.project.connection.error',
}

export function credentialStatusKey(credential: ProjectCredentialStatus): TranslationKey {
  if (credential.lastError) return 'settings.project.credential.storageError'
  if (!credential.secureStorageAvailable) return 'settings.project.credential.unavailable'
  return credential.configured
    ? 'settings.project.credential.savedSecurely'
    : 'settings.project.credential.notConfigured'
}
