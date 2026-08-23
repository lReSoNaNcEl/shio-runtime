import type { ProjectSnapshotFreshness } from './freshness'

export interface ProjectEvidenceSource {
  path: string
  startLine?: number
  endLine?: number
}

/** Runtime-owned, turn-scoped facts derived from the exact Project Context Packet used. */
export interface ProjectReplyProvenance {
  pluginId: 'project-awareness'
  repository: string
  branch: string
  snapshotCommit: string
  freshnessAtGeneration?: ProjectSnapshotFreshness
  sources: readonly ProjectEvidenceSource[]
}
