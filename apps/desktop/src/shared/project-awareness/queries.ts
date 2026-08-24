import type { ProjectSnapshotIdentity } from './repository'

export type ProjectSymbolKind = 'class' | 'function' | 'interface' | 'type' | 'const' | 'method'

export interface ProjectMapSection {
  name: string
  paths: string[]
}

export interface ProjectRuntimeSummary {
  name: string
  path: string
  exportedSymbols: string[]
}

export interface ProjectFlowSummary {
  name: string
  files: string[]
}

export interface ProjectKeyFile {
  path: string
  reason: string
}

export interface ProjectSymbolReference {
  path: string
  name: string
  kind: ProjectSymbolKind
  startLine: number
  endLine: number
}

export interface ProjectMap {
  snapshot: ProjectSnapshotIdentity
  overview: string
  architecture: ProjectMapSection[]
  runtimeSystems: ProjectRuntimeSummary[]
  keyFlows: ProjectFlowSummary[]
  keyFiles: ProjectKeyFile[]
  ownershipRules: string[]
  importantSymbols: ProjectSymbolReference[]
}

export interface ProjectSearchInput {
  query: string
  hints?: {
    paths?: readonly string[]
    symbols?: readonly string[]
  }
  limit?: number
  maxCharacters?: number
}

export interface ProjectReadFileInput {
  path: string
  startLine?: number
  endLine?: number
}

export interface ProjectReadSymbolInput {
  name: string
  path?: string
}

export interface ProjectRecentChangesInput {
  limit?: number
  query?: string
}

export interface ProjectEvidence {
  path: string
  startLine: number
  endLine: number
  symbol?: string
  commitSha: string
  content: string
  relevance: number
}

export interface ProjectSearchResult extends ProjectEvidence {}

export interface ProjectFileExcerpt extends ProjectEvidence {}

export interface ProjectSymbolExcerpt extends ProjectEvidence {}

export interface ProjectCommitSummary {
  sha: string
  message: string
  summary: string
  authoredAt: number
  changedFiles: string[]
  relatedSymbols: ProjectSymbolReference[]
}

export interface ProjectChangeSummary {
  repository: string
  branch: string
  commits: ProjectCommitSummary[]
}

export interface ProjectSyncResult {
  status: 'indexed' | 'unchanged'
  commitSha: string
  indexedFiles: number
  changedFiles: number
  completedAt: number
}
