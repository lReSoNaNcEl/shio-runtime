export type ProjectProvider = 'github'

export type ProjectLanguage =
  | 'typescript'
  | 'typescriptreact'
  | 'javascript'
  | 'javascriptreact'
  | 'python'
  | 'markdown'
  | 'json'
  | 'yaml'

export interface ProjectRepositoryIdentity {
  provider: ProjectProvider
  owner: string
  name: string
  defaultBranch: string
}

export interface ProjectSnapshotIdentity {
  repository: ProjectRepositoryIdentity
  branch: string
  commitSha: string
  createdAt: number
}

export interface ProjectSourceFile {
  path: string
  sha: string
  size: number
  language: ProjectLanguage
  content?: string
}

export interface ProjectConnectorStatus {
  state: 'disconnected' | 'connecting' | 'ready' | 'error'
  repository?: ProjectRepositoryIdentity
  branch?: string
  headSha?: string
  lastError?: string
}

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

export interface ProjectAwarenessStatus {
  enabled: boolean
  state: ProjectAwarenessState
  provider: ProjectProvider
  repository: string
  branch: string
  remoteHead?: string
  indexedCommit?: string
  indexState: ProjectIndexState
  access: 'read-only'
  lastSyncAt?: number
  lastError?: string
  indexedFileCount: number
  credential: ProjectCredentialStatus
}

export type ProjectSymbolKind = 'class' | 'function' | 'interface' | 'type' | 'const' | 'method'

export interface IndexedProjectFile {
  snapshotId: string
  path: string
  blobSha: string
  language: ProjectLanguage
  contentHash: string
  summary: string | null
}

export interface IndexedSymbol {
  fileId: string
  name: string
  kind: ProjectSymbolKind
  exported: boolean
  startLine: number
  endLine: number
  signature: string | null
}

export interface IndexedChunk {
  fileId: string
  startLine: number
  endLine: number
  symbolName: string | null
  content: string
}

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

export interface ProjectAwarenessPublicConfig {
  enabled: boolean
  provider: ProjectProvider
  repository: string
  branch: string
}

export function isValidProjectRepository(value: string): boolean {
  return /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.test(value.trim())
}

export function isValidProjectBranch(value: string): boolean {
  const branch = value.trim()
  return (
    branch.length > 0 &&
    branch.length <= 255 &&
    !/[\s~^:?*[\]\\]/.test(branch) &&
    !branch.startsWith('.') &&
    !branch.startsWith('/') &&
    !branch.endsWith('.') &&
    !branch.endsWith('/') &&
    !branch.endsWith('.lock') &&
    !branch.includes('..') &&
    !branch.includes('@{') &&
    !branch.includes('//')
  )
}

export interface ProjectAwarenessApi {
  getStatus(): Promise<ProjectAwarenessStatus>
  configure(config: ProjectAwarenessPublicConfig): Promise<ProjectAwarenessStatus>
  saveCredential(token: string): Promise<ProjectAwarenessStatus>
  forgetCredential(): Promise<ProjectAwarenessStatus>
  openTokenSettings(): Promise<void>
  connect(): Promise<ProjectAwarenessStatus>
  disconnect(): Promise<ProjectAwarenessStatus>
  sync(): Promise<ProjectSyncResult>
  rebuildIndex(): Promise<ProjectSyncResult>
  getProjectMap(): Promise<ProjectMap | null>
  search(input: ProjectSearchInput): Promise<ProjectSearchResult[]>
  readFile(input: ProjectReadFileInput): Promise<ProjectFileExcerpt>
  readSymbol(input: ProjectReadSymbolInput): Promise<ProjectSymbolExcerpt>
  getRecentChanges(input: ProjectRecentChangesInput): Promise<ProjectChangeSummary>
}
