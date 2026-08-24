import type { ProjectFreshness, ProjectSnapshotDelta } from './freshness'
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

export interface ProjectSnapshotStatus {
  revision: string
  indexedAt: number
  fileCount: number
}

export type ProjectSyncStage = 'fetching' | 'indexing' | 'validating'

export interface ProjectSyncStatus {
  state: 'idle' | 'syncing' | 'failed'
  stage?: ProjectSyncStage
  startedAt?: number
  completedAt?: number
  lastError?: string
}

export interface ProjectAwarenessStatus {
  enabled: boolean
  state: ProjectAwarenessState
  provider: ProjectProvider
  repository: string
  branch: string
  snapshot?: ProjectSnapshotStatus
  freshness: ProjectFreshness
  changedFiles?: ProjectSnapshotDelta
  sync: ProjectSyncStatus
  indexState: ProjectIndexState
  access: 'read-only'
  lastSyncAt?: number
  lastError?: string
  credential: ProjectCredentialStatus
}
