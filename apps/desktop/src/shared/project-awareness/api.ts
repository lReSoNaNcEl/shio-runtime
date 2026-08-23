import type {
  ProjectChangeSummary,
  ProjectFileExcerpt,
  ProjectMap,
  ProjectReadFileInput,
  ProjectReadSymbolInput,
  ProjectRecentChangesInput,
  ProjectSearchInput,
  ProjectSearchResult,
  ProjectSymbolExcerpt,
  ProjectSyncResult,
} from './queries'
import type { ProjectProvider } from './repository'
import type { ProjectAwarenessStatus } from './status'

export interface ProjectAwarenessPublicConfig {
  provider: ProjectProvider
  repository: string
  branch: string
}

export interface ProjectAwarenessApi {
  getConfig(): Promise<ProjectAwarenessPublicConfig>
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
