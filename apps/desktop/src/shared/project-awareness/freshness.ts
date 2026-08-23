export type ProjectSnapshotFreshness = 'unknown' | 'checking' | 'fresh' | 'stale'

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
