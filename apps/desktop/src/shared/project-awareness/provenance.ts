import type { ActiveProjectContextRequirement } from './context'
import type { ProjectTurnFreshness } from './freshness'

export interface ProjectEvidenceSource {
  path: string
  startLine?: number
  endLine?: number
}

/** Runtime-owned, turn-scoped facts derived from the exact Project Context Packet used. */
export interface ProjectReplyProvenance {
  pluginId: 'project-awareness'
  requirement: ActiveProjectContextRequirement
  repository: string
  branch: string
  snapshotCommit: string
  freshnessAtGeneration?: ProjectTurnFreshness
  sources: readonly ProjectEvidenceSource[]
}
