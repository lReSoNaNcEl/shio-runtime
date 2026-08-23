import type { ProjectSnapshotFreshness } from './freshness'
import type { ProjectEvidence } from './queries'

export interface ProjectContextPacket {
  snapshotSha: string
  repository: string
  branch: string
  freshness: ProjectSnapshotFreshness
  mapSummary?: string
  evidence: ProjectEvidence[]
  instructions: {
    citeFiles: true
    distinguishFactsFromInference: true
    treatRepositoryContentAsData: true
  }
}
