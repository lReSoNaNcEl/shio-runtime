export type ProjectFreshnessState = 'unknown' | 'checking' | 'current' | 'stale' | 'check-failed'

export type ProjectTurnFreshness = 'unknown' | 'current' | 'stale'

export type ProjectFreshnessFailureReason =
  | 'credential'
  | 'network'
  | 'rate-limit'
  | 'github-unavailable'
  | 'unknown'

/** Main-owned comparison between one immutable local snapshot and Remote HEAD. */
export interface ProjectFreshness {
  state: ProjectFreshnessState
  indexedRevision?: string
  remoteRevision?: string
  checkedAt?: number
  lastKnownRemoteRevision?: string
  lastKnownRemoteCheckedAt?: number
  reasonCode?: ProjectFreshnessFailureReason
}

export type ProjectSnapshotDeltaFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface ProjectSnapshotDeltaFile {
  path: string
  status: ProjectSnapshotDeltaFileStatus
}

/** Deterministic and bounded comparison between the indexed snapshot and Remote HEAD. */
export interface ProjectSnapshotDelta {
  total: number
  added: number
  modified: number
  deleted: number
  renamed: number
  files: readonly ProjectSnapshotDeltaFile[]
  omitted: number
}
