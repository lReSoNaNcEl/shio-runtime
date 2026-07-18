import type { ProjectRepositoryIdentity, ProjectSourceFile } from '../../shared/projectAwareness'

export interface ProjectTreeEntry {
  path: string
  sha: string
  size: number
  type: 'blob'
}

export interface ProjectChangedFile {
  path: string
  previousPath?: string
  status: 'added' | 'modified' | 'removed' | 'renamed'
}

export interface ProjectCommit {
  sha: string
  message: string
  authoredAt: number
  parentShas: string[]
}

export interface ProjectRepositoryAdapter {
  getRepository(): Promise<ProjectRepositoryIdentity>
  getBranchHead(branch: string): Promise<string>
  listTree(commitSha: string): Promise<ProjectTreeEntry[]>
  readFile(path: string, commitSha: string): Promise<ProjectSourceFile>
  compareCommits(baseSha: string, headSha: string): Promise<ProjectChangedFile[]>
  listRecentCommits(branch: string, limit: number): Promise<ProjectCommit[]>
}

export interface ExtractedSymbol {
  name: string
  kind: 'class' | 'function' | 'interface' | 'type' | 'const' | 'method'
  exported: boolean
  startLine: number
  endLine: number
  signature: string | null
}

export interface ExtractedChunk {
  startLine: number
  endLine: number
  symbolName: string | null
  content: string
}

export interface ExtractedSource {
  symbols: ExtractedSymbol[]
  chunks: ExtractedChunk[]
  imports: string[]
}

export interface PreparedProjectFile {
  path: string
  blobSha: string
  language: ProjectSourceFile['language']
  contentHash: string
  size: number
  priority: number
  content: string
  imports: string[]
  symbols: ExtractedSymbol[]
  chunks: ExtractedChunk[]
}
