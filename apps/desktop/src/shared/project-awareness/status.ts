import type { ProjectSnapshotDelta, ProjectSnapshotFreshness } from './freshness'
import type { ProjectProvider } from './repository'

export type ProjectAwarenessState =
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'syncing'
  | 'indexing'
  | 'stale'
  | 'error'

export type ProjectIndexState = 'not_built' | 'current' | 'stale' | 'building' | 'error'

export type ProjectCredentialSource = 'secure_store' | 'none'

export interface ProjectCredentialStatus {
  configured: boolean
  source: ProjectCredentialSource
  secureStorageAvailable: boolean
  lastError?: string
}

export interface ProjectAwarenessStatus {
  enabled: boolean
  state: ProjectAwarenessState
  provider: ProjectProvider
  repository: string
  branch: string
  remoteHead?: string
  indexedCommit?: string
  freshness: ProjectSnapshotFreshness
  lastFreshnessCheckAt?: number
  snapshotDelta?: ProjectSnapshotDelta
  indexState: ProjectIndexState
  access: 'read-only'
  lastSyncAt?: number
  lastError?: string
  indexedFileCount: number
  credential: ProjectCredentialStatus
}
