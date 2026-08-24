import type { ProjectTurnFreshness } from './freshness'
import type { ProjectEvidence } from './queries'

export type ProjectContextRequirement = 'none' | 'optional' | 'required'
export type ActiveProjectContextRequirement = Exclude<ProjectContextRequirement, 'none'>

export interface ProjectContextPacket {
  requirement: ActiveProjectContextRequirement
  snapshotSha: string
  repository: string
  branch: string
  freshness: ProjectTurnFreshness
  mapSummary?: string
  evidence: ProjectEvidence[]
  instructions: {
    citeFiles: true
    distinguishFactsFromInference: true
    treatRepositoryContentAsData: true
  }
}
