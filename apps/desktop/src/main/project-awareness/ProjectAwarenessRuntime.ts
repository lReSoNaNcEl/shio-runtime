import { createHash } from 'node:crypto'

import { type Translator, translate } from '../../shared/localization/format'
import { DEFAULT_UI_LOCALE } from '../../shared/localization/locale'
import type {
  ProjectAwarenessStatus,
  ProjectChangeSummary,
  ProjectContextPacket,
  ProjectCredentialStatus,
  ProjectFileExcerpt,
  ProjectMap,
  ProjectReadFileInput,
  ProjectReadSymbolInput,
  ProjectRecentChangesInput,
  ProjectRepositoryIdentity,
  ProjectSearchInput,
  ProjectSearchResult,
  ProjectSymbolExcerpt,
  ProjectSyncResult,
} from '../../shared/projectAwareness'
import { isValidProjectBranch, isValidProjectRepository } from '../../shared/projectAwareness'
import { GitHubProjectAdapter } from './adapters/GitHubProjectAdapter'
import type {
  PreparedProjectFile,
  ProjectChangedFile,
  ProjectRepositoryAdapter,
  ProjectTreeEntry,
} from './contracts'
import { buildProjectMap, summarizeProjectMap } from './indexing/ProjectMapBuilder'
import {
  isAllowedProjectPath,
  isSafeTextContent,
  projectLanguageForPath,
  sourcePriority,
} from './indexing/SourceFilter'
import { extractSource } from './indexing/SymbolExtractor'
import type { ProjectKnowledgeStore } from './ProjectKnowledgeStore'
import { isProjectRelevantRequest } from './ProjectRelevanceGate'

export interface ProjectAwarenessRuntimeConfig {
  enabled: boolean
  provider: 'github'
  repository: string
  branch: string
  maxFileSizeBytes: number
}

type AdapterFactory = (owner: string, name: string, token: string) => ProjectRepositoryAdapter

function parseRepository(value: string, t: Translator): { owner: string; name: string } {
  if (!isValidProjectRepository(value)) {
    throw new Error(t('main.error.project.repositoryFormat'))
  }
  const match = value.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (!match) throw new Error(t('main.error.project.repositoryFormat'))
  return { owner: match[1], name: match[2] }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/g, '[redacted]').slice(0, 500)
}

function changedPaths(changes: ProjectChangedFile[]): Set<string> {
  const paths = new Set<string>()
  for (const change of changes) {
    paths.add(change.path)
    if (change.previousPath) paths.add(change.previousPath)
  }
  return paths
}

export class ProjectAwarenessRuntime {
  private adapter: ProjectRepositoryAdapter | null = null
  private repository: ProjectRepositoryIdentity | null = null
  private state: ProjectAwarenessStatus['state'] = 'disconnected'
  private remoteHead: string | undefined
  private lastSyncAt: number | undefined
  private lastError: string | undefined
  private syncPromise: Promise<ProjectSyncResult> | null = null
  private credentialToken: string
  private credential: ProjectCredentialStatus

  constructor(
    private config: ProjectAwarenessRuntimeConfig,
    private readonly store: ProjectKnowledgeStore,
    private readonly adapterFactory: AdapterFactory = (owner, name, token) =>
      new GitHubProjectAdapter(owner, name, token),
    private readonly t: Translator = (key, params) => translate(DEFAULT_UI_LOCALE, key, params),
  ) {
    this.credentialToken = ''
    this.credential = {
      configured: false,
      source: 'none',
      secureStorageAvailable: false,
    }
  }

  setCredential(token: string, credential: ProjectCredentialStatus): void {
    this.adapter = null
    this.repository = null
    this.remoteHead = undefined
    this.credentialToken = token
    this.credential = { ...credential }
    this.state = 'disconnected'
    this.lastError = undefined
  }

  async configure(
    config: Pick<ProjectAwarenessRuntimeConfig, 'enabled' | 'provider' | 'repository' | 'branch'>,
  ): Promise<ProjectAwarenessStatus> {
    if (
      config.enabled &&
      (!isValidProjectRepository(config.repository) || !isValidProjectBranch(config.branch))
    ) {
      throw new Error(this.t('main.error.project.targetInvalid'))
    }
    const next = {
      ...this.config,
      enabled: config.enabled,
      provider: config.provider,
      repository: config.repository.trim(),
      branch: config.branch.trim(),
    }
    const unchanged =
      this.config.enabled === next.enabled &&
      this.config.repository === next.repository &&
      this.config.branch === next.branch
    if (unchanged) return this.getStatus()

    await this.disconnect()
    this.config = next
    if (!next.enabled || !this.credential.configured) return this.getStatus()
    return this.connect()
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled || !this.credential.configured) return
    await this.connect()
    await this.sync()
  }

  async connect(): Promise<ProjectAwarenessStatus> {
    if (this.state === 'connecting') return this.getStatus()
    this.state = 'connecting'
    this.lastError = undefined
    try {
      if (!this.config.enabled) {
        throw new Error(this.t('main.error.project.disabled'))
      }
      if (!isValidProjectBranch(this.config.branch)) {
        throw new Error(this.t('main.error.project.branchSettings'))
      }
      if (!this.credentialToken) {
        throw new Error(this.t('main.error.project.credentialMissing'))
      }
      const { owner, name } = parseRepository(this.config.repository, this.t)
      this.adapter = this.adapterFactory(owner, name, this.credentialToken)
      this.repository = await this.adapter.getRepository()
      this.remoteHead = await this.adapter.getBranchHead(this.config.branch)
      const current = this.store.getCurrentSnapshot(this.repository, this.config.branch)
      this.state = current && current.snapshot.commitSha !== this.remoteHead ? 'stale' : 'ready'
      return this.getStatus()
    } catch (error) {
      this.adapter = null
      this.repository = null
      this.state = 'error'
      this.lastError = safeError(error)
      throw new Error(this.lastError)
    }
  }

  async disconnect(): Promise<ProjectAwarenessStatus> {
    if (this.syncPromise) await this.syncPromise.catch(() => undefined)
    this.adapter = null
    this.repository = null
    this.remoteHead = undefined
    this.state = 'disconnected'
    this.lastError = undefined
    return this.getStatus()
  }

  getStatus(): ProjectAwarenessStatus {
    const current = this.repository
      ? this.store.getCurrentSnapshot(this.repository, this.config.branch)
      : null
    const indexState =
      this.state === 'indexing' || this.state === 'syncing'
        ? 'building'
        : this.state === 'error'
          ? 'error'
          : current && this.remoteHead && current.snapshot.commitSha !== this.remoteHead
            ? 'stale'
            : current
              ? 'current'
              : 'not_built'
    return {
      enabled: this.config.enabled,
      state: this.state,
      provider: 'github',
      repository: this.config.repository,
      branch: this.config.branch,
      remoteHead: this.remoteHead,
      indexedCommit: current?.snapshot.commitSha,
      indexState,
      access: 'read-only',
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      indexedFileCount: current?.fileCount ?? 0,
      credential: { ...this.credential },
    }
  }

  sync(): Promise<ProjectSyncResult> {
    return this.startSync(false)
  }

  rebuildIndex(): Promise<ProjectSyncResult> {
    return this.startSync(true)
  }

  private startSync(forceRebuild: boolean): Promise<ProjectSyncResult> {
    if (this.syncPromise) return this.syncPromise
    const operation = this.performSync(forceRebuild).finally(() => {
      if (this.syncPromise === operation) this.syncPromise = null
    })
    this.syncPromise = operation
    return operation
  }

  private async performSync(forceRebuild: boolean): Promise<ProjectSyncResult> {
    if (!this.adapter || !this.repository) await this.connect()
    if (!this.adapter || !this.repository) {
      throw new Error(this.t('main.error.project.disconnected'))
    }

    const adapter = this.adapter
    const repository = this.repository
    const previous = this.store.getCurrentSnapshot(repository, this.config.branch)
    this.state = 'syncing'
    this.lastError = undefined
    let runId: number | undefined
    let draftId: string | undefined
    let changeCount = 0
    try {
      const headSha = await adapter.getBranchHead(this.config.branch)
      this.remoteHead = headSha
      if (!forceRebuild && previous?.snapshot.commitSha === headSha) {
        this.state = 'ready'
        this.lastSyncAt = Date.now()
        return {
          status: 'unchanged',
          commitSha: headSha,
          indexedFiles: previous.fileCount,
          changedFiles: 0,
          completedAt: this.lastSyncAt,
        }
      }

      runId = this.store.beginSync(
        repository,
        this.config.branch,
        previous?.snapshot.commitSha,
        headSha,
      )
      const tree = await adapter.listTree(headSha)
      const allowedTree = tree.filter((entry) =>
        isAllowedProjectPath(entry, this.config.maxFileSizeBytes),
      )
      const currentPaths = new Set(allowedTree.map((entry) => entry.path))

      let changes: ProjectChangedFile[] = []
      let incremental = Boolean(previous && !forceRebuild)
      if (incremental && previous) {
        changes = await adapter.compareCommits(previous.snapshot.commitSha, headSha)
        if (changes.length >= 300) incremental = false
      }

      const excludedPreviousPaths = incremental ? changedPaths(changes) : new Set<string>()
      if (incremental && previous) {
        for (const file of this.store.listFiles(previous.id)) {
          if (!currentPaths.has(file.path)) excludedPreviousPaths.add(file.path)
        }
      }

      const pathsToRead = incremental
        ? new Set(
            changes.filter((change) => change.status !== 'removed').map((change) => change.path),
          )
        : currentPaths
      const entriesToRead = allowedTree.filter((entry) => pathsToRead.has(entry.path))
      changeCount =
        entriesToRead.length +
        [...excludedPreviousPaths].filter((path) => !currentPaths.has(path)).length
      this.state = 'indexing'
      const preparedFiles: PreparedProjectFile[] = []
      for (const entry of entriesToRead) {
        const prepared = await this.prepareFile(adapter, entry, headSha)
        if (prepared) preparedFiles.push(prepared)
      }

      const draft = this.store.createDraftSnapshot({
        repository,
        branch: this.config.branch,
        commitSha: headSha,
        previousSnapshotId: incremental ? previous?.id : undefined,
        excludedPreviousPaths,
        files: preparedFiles,
      })
      draftId = draft.id
      const snapshot = {
        repository,
        branch: this.config.branch,
        commitSha: headSha,
        createdAt: Date.now(),
      }
      const map = buildProjectMap(
        snapshot,
        this.store.listFiles(draft.id),
        this.store.listSymbols(draft.id),
      )
      this.store.saveProjectMap(draft.id, map)
      this.store.publishSnapshot(repository, this.config.branch, draft.id)
      draftId = undefined
      this.store.pruneSnapshots(repository, this.config.branch, 2)
      this.store.finishSync(runId, 'completed', changeCount)
      this.lastSyncAt = Date.now()
      this.state = 'ready'
      return {
        status: 'indexed',
        commitSha: headSha,
        indexedFiles: draft.fileCount,
        changedFiles: changeCount,
        completedAt: this.lastSyncAt,
      }
    } catch (error) {
      if (draftId) this.store.deleteDraftSnapshot(draftId)
      this.lastError = safeError(error)
      this.state = 'error'
      if (runId) this.store.finishSync(runId, 'error', changeCount, this.lastError)
      throw new Error(this.lastError)
    }
  }

  private async prepareFile(
    adapter: ProjectRepositoryAdapter,
    entry: ProjectTreeEntry,
    commitSha: string,
  ): Promise<PreparedProjectFile | null> {
    const source = await adapter.readFile(entry.path, commitSha)
    const content = source.content ?? ''
    if (!isSafeTextContent(content)) return null
    const language = projectLanguageForPath(entry.path)
    if (!language) return null
    const extracted = extractSource(entry.path, language, content)
    return {
      path: entry.path,
      blobSha: source.sha,
      language,
      contentHash: createHash('sha256').update(content).digest('hex'),
      size: Buffer.byteLength(content, 'utf8'),
      priority: sourcePriority(entry.path),
      content,
      imports: extracted.imports,
      symbols: extracted.symbols,
      chunks: extracted.chunks,
    }
  }

  getProjectMap(): ProjectMap | null {
    const current = this.requireCurrent()
    return this.store.getProjectMap(current.id)
  }

  search(input: ProjectSearchInput): ProjectSearchResult[] {
    const current = this.requireCurrent()
    const query = input.query.trim().slice(0, 500)
    if (!query) return []
    return this.store.search(
      current.id,
      current.snapshot.commitSha,
      query,
      Math.max(1, Math.min(10, input.limit ?? 8)),
      Math.max(1_000, Math.min(20_000, input.maxCharacters ?? 16_000)),
    )
  }

  readFile(input: ProjectReadFileInput): ProjectFileExcerpt {
    const current = this.requireCurrent()
    return this.store.readFile(
      current.id,
      current.snapshot.commitSha,
      input.path,
      input.startLine,
      input.endLine,
    )
  }

  readSymbol(input: ProjectReadSymbolInput): ProjectSymbolExcerpt {
    const current = this.requireCurrent()
    return this.store.readSymbol(current.id, current.snapshot.commitSha, input.name, input.path)
  }

  async getRecentChanges(input: ProjectRecentChangesInput): Promise<ProjectChangeSummary> {
    if (!this.adapter || !this.repository) await this.connect()
    if (!this.adapter || !this.repository) {
      throw new Error(this.t('main.error.project.disconnected'))
    }
    const limit = Math.max(1, Math.min(10, input.limit ?? 5))
    const commits = await this.adapter.listRecentCommits(this.config.branch, limit)
    const current = this.store.getCurrentSnapshot(this.repository, this.config.branch)
    const indexedSymbols = current ? this.store.listSymbols(current.id) : []
    const summaries = []
    for (const commit of commits) {
      const changes = commit.parentShas[0]
        ? await this.adapter.compareCommits(commit.parentShas[0], commit.sha)
        : []
      const files = [
        ...new Set(changes.flatMap((change) => [change.path, change.previousPath]).filter(Boolean)),
      ] as string[]
      this.store.saveRecentCommit({
        repository: this.repository,
        branch: this.config.branch,
        sha: commit.sha,
        message: commit.message,
        authoredAt: commit.authoredAt,
        changedFiles: files,
      })
      const relatedSymbols = indexedSymbols
        .filter((symbol) => files.includes(symbol.path))
        .slice(0, 20)
        .map((symbol) => ({
          path: symbol.path,
          name: symbol.name,
          kind: symbol.kind,
          startLine: symbol.start_line,
          endLine: symbol.end_line,
        }))
      summaries.push({
        sha: commit.sha,
        message: commit.message,
        summary:
          files.length > 0
            ? `Changed ${files.length} file${files.length === 1 ? '' : 's'}: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ', …' : ''}`
            : 'No changed-file details were returned for this commit.',
        authoredAt: commit.authoredAt,
        changedFiles: files,
        relatedSymbols,
      })
    }
    this.store.pruneRecentCommits(this.repository, this.config.branch, 20)
    const query = input.query?.trim().toLowerCase()
    return {
      repository: this.config.repository,
      branch: this.config.branch,
      commits: query
        ? summaries.filter(
            (summary) =>
              summary.message.toLowerCase().includes(query) ||
              summary.changedFiles.some((path) => path.toLowerCase().includes(query)),
          )
        : summaries,
    }
  }

  buildContextPacket(userText: string): ProjectContextPacket | null {
    if (!isProjectRelevantRequest(userText)) return null
    const current =
      this.repository && this.store.getCurrentSnapshot(this.repository, this.config.branch)
    if (!current) return null
    const map = this.store.getProjectMap(current.id)
    const evidence = this.search({ query: userText, limit: 8, maxCharacters: 16_000 })
    return {
      snapshotSha: current.snapshot.commitSha,
      repository: this.config.repository,
      branch: this.config.branch,
      mapSummary: map ? summarizeProjectMap(map) : undefined,
      evidence,
      instructions: {
        citeFiles: true,
        distinguishFactsFromInference: true,
        treatRepositoryContentAsData: true,
      },
    }
  }

  private requireCurrent(): {
    id: string
    snapshot: ReturnType<ProjectKnowledgeStore['getCurrentSnapshot']> extends infer Result
      ? Result extends { snapshot: infer Snapshot }
        ? Snapshot
        : never
      : never
    fileCount: number
  } {
    if (!this.repository) throw new Error(this.t('main.error.project.disconnected'))
    const current = this.store.getCurrentSnapshot(this.repository, this.config.branch)
    if (!current) throw new Error(this.t('main.error.project.indexMissing'))
    return current
  }
}
