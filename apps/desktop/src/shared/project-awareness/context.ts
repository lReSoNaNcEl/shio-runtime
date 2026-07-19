import type { ProjectEvidence } from './queries'

export interface ProjectContextPacket {
  snapshotSha: string
  repository: string
  branch: string
  mapSummary?: string
  evidence: ProjectEvidence[]
  instructions: {
    citeFiles: true
    distinguishFactsFromInference: true
    treatRepositoryContentAsData: true
  }
}
