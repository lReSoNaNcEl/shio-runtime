import { createHash } from 'node:crypto'

import { DEFAULT_UI_LOCALE, type Translator, translate } from '../../shared/localization'
import type {
  ProjectAwarenessStatus,
  ProjectChangeSummary,
  ProjectContextPacket,
  ProjectContextRequirement,
  ProjectCredentialStatus,
  ProjectFileExcerpt,
  ProjectMap,
  ProjectReadFileInput,
  ProjectReadSymbolInput,
  ProjectRecentChangesInput,
  ProjectRepositoryIdentity,
  ProjectSearchInput,
  ProjectSearchResult,
  ProjectSnapshotDelta,
  ProjectSymbolExcerpt,
  ProjectSyncResult,
} from '../../shared/project-awareness'
import { isValidProjectBranch, isValidProjectRepository } from '../../shared/project-awareness'
import { mainLog } from '../logging/safeLogger'
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
import { projectContextRequirement } from './ProjectRelevanceGate'
import { PROJECT_CONTEXT_BUDGET, selectProjectEvidence } from './retrieval/ProjectEvidenceSelector'

export interface ProjectAwarenessRuntimeConfig {
  enabled: boolean
  provider: 'github'
  repository: string
  branch: string
  maxFileSizeBytes: number
}

type AdapterFactory = (owner: string, name: string, token: string) => ProjectRepositoryAdapter

const FRESHNESS_TTL_MS = 60_000
const SNAPSHOT_DELTA_FILE_LIMIT = 12

function safeTraceId(value: string | undefined): string {
  return value && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : 'untracked'
}

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

function snapshotDelta(changes: readonly ProjectChangedFile[]): ProjectSnapshotDelta {
  const files = changes
    .filter((change) => {
      const path = change.path.replaceAll('\\', '/')
      return (
        path.length > 0 &&
        path.length <= 500 &&
        !path.startsWith('/') &&
        !/^[A-Za-z]:/.test(path) &&
        !path.split('/').some((segment) => segment === '..' || segment === '')
      )
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .slice(0, SNAPSHOT_DELTA_FILE_LIMIT)
    .map((change) => ({
      path: change.path.replaceAll('\\', '/'),
      status: change.status === 'removed' ? ('deleted' as const) : change.status,
    }))
  return {
    total: changes.length,
    added: changes.filter((change) => change.status === 'added').length,
    modified: changes.filter((change) => change.status === 'modified').length,
    deleted: changes.filter((change) => change.status === 'removed').length,
    renamed: changes.filter((change) => change.status === 'renamed').length,
    files,
    omitted: Math.max(0, changes.length - files.length),
  }
}

export class ProjectAwarenessRuntime {
  private adapter: ProjectRepositoryAdapter | null = null
  private repository: ProjectRepositoryIdentity | null = null
  private state: ProjectAwarenessStatus['state'] = 'disconnected'
  private remoteHead: string | undefined
  private lastSyncAt: number | undefined
  private lastFreshnessCheckAt: number | undefined
  private snapshotDelta: ProjectSnapshotDelta | undefined
  private freshnessChecking = false
  private freshnessPromise: Promise<ProjectAwarenessStatus> | null = null
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
    this.lastFreshnessCheckAt = undefined
    this.snapshotDelta = undefined
    this.credentialToken = token
    this.credential = { ...credential }
    this.state = 'disconnected'
    this.lastError = undefined
  }

  async configure(
    config: Pick<ProjectAwarenessRuntimeConfig, 'provider' | 'repository' | 'branch'>,
  ): Promise<ProjectAwarenessStatus> {
    if (
      this.config.enabled &&
      (!isValidProjectRepository(config.repository) || !isValidProjectBranch(config.branch))
    ) {
      throw new Error(this.t('main.error.project.targetInvalid'))
    }
    const next = {
      ...this.config,
      provider: config.provider,
      repository: config.repository.trim(),
      branch: config.branch.trim(),
    }
    const unchanged =
      this.config.repository === next.repository && this.config.branch === next.branch
    if (unchanged) return this.getStatus()

    await this.disconnect()
    this.config = next
    if (!next.enabled || !this.credential.configured) return this.getStatus()
    return this.connect()
  }

  async setEnabled(enabled: boolean): Promise<ProjectAwarenessStatus> {
    if (this.config.enabled === enabled) return this.getStatus()
    await this.disconnect()
    this.config = { ...this.config, enabled }
    return this.getStatus()
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled || !this.credential.configured) return
    await this.connect()
    if (this.adapter && this.repository && this.remoteHead) await this.sync()
  }

  async connect(): Promise<ProjectAwarenessStatus> {
    if (this.state === 'connecting') return this.getStatus()
    this.state = 'connecting'
    this.freshnessChecking = true
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
      this.lastFreshnessCheckAt = Date.now()
      const current = this.currentSnapshot()
      this.snapshotDelta = await this.buildSnapshotDelta(current, this.remoteHead)
      this.state = 'ready'
      return this.getStatus()
    } catch (error) {
      const current = this.currentSnapshot()
      this.remoteHead = undefined
      this.lastFreshnessCheckAt = Date.now()
      this.snapshotDelta = undefined
      if (current) {
        this.repository = current.snapshot.repository
        this.state = 'ready'
        this.lastError = undefined
        return this.getStatus()
      }
      this.adapter = null
      this.repository = null
      this.state = 'error'
      this.lastError = safeError(error)
      throw new Error(this.lastError)
    } finally {
      this.freshnessChecking = false
    }
  }

  async disconnect(): Promise<ProjectAwarenessStatus> {
    if (this.syncPromise) await this.syncPromise.catch(() => undefined)
    this.adapter = null
    this.repository = null
    this.remoteHead = undefined
    this.lastFreshnessCheckAt = undefined
    this.snapshotDelta = undefined
    this.state = 'disconnected'
    this.lastError = undefined
    return this.getStatus()
  }

  getStatus(): ProjectAwarenessStatus {
    const current = this.currentSnapshot()
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
      freshness: this.freshnessChecking
        ? 'checking'
        : !current || !this.remoteHead
          ? 'unknown'
          : current.snapshot.commitSha === this.remoteHead
            ? 'fresh'
            : 'stale',
      lastFreshnessCheckAt: this.lastFreshnessCheckAt,
      snapshotDelta:
        current && this.remoteHead && current.snapshot.commitSha !== this.remoteHead
          ? this.snapshotDelta
          : undefined,
      indexState,
      access: 'read-only',
      lastSyncAt: this.lastSyncAt ?? current?.snapshot.createdAt,
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

  refreshSnapshotStatus(force = false): Promise<ProjectAwarenessStatus> {
    if (this.freshnessPromise) return this.freshnessPromise
    if (
      !force &&
      this.lastFreshnessCheckAt &&
      Date.now() - this.lastFreshnessCheckAt < FRESHNESS_TTL_MS
    ) {
      return Promise.resolve(this.getStatus())
    }
    const operation = this.performFreshnessCheck().finally(() => {
      if (this.freshnessPromise === operation) this.freshnessPromise = null
    })
    this.freshnessPromise = operation
    return operation
  }

  private async performFreshnessCheck(): Promise<ProjectAwarenessStatus> {
    if (!this.config.enabled || !this.credential.configured) return this.getStatus()
    const current = this.currentSnapshot()
    this.freshnessChecking = true
    try {
      if (!this.adapter) {
        const { owner, name } = parseRepository(this.config.repository, this.t)
        this.adapter = this.adapterFactory(owner, name, this.credentialToken)
      }
      this.repository ??= current?.snapshot.repository ?? (await this.adapter.getRepository())
      this.remoteHead = await this.adapter.getBranchHead(this.config.branch)
      this.lastFreshnessCheckAt = Date.now()
      this.snapshotDelta = await this.buildSnapshotDelta(current, this.remoteHead)
      if (this.state !== 'syncing' && this.state !== 'indexing') this.state = 'ready'
      this.lastError = undefined
    } catch (error) {
      this.remoteHead = undefined
      this.lastFreshnessCheckAt = Date.now()
      this.snapshotDelta = undefined
      if (current) {
        this.repository = current.snapshot.repository
        if (this.state !== 'syncing' && this.state !== 'indexing') this.state = 'ready'
        this.lastError = undefined
      } else {
        this.state = 'error'
        this.lastError = safeError(error)
      }
    } finally {
      this.freshnessChecking = false
    }
    return this.getStatus()
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
        this.lastFreshnessCheckAt = this.lastSyncAt
        this.snapshotDelta = undefined
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
      this.lastFreshnessCheckAt = this.lastSyncAt
      this.snapshotDelta = undefined
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
      this.remoteHead = undefined
      this.lastFreshnessCheckAt = Date.now()
      this.snapshotDelta = undefined
      this.state = this.currentSnapshot() ? 'ready' : 'error'
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
    const maxEvidenceItems = Math.max(1, Math.min(10, input.limit ?? 8))
    const maxCharacters = Math.max(1_000, Math.min(20_000, input.maxCharacters ?? 16_000))
    const retrieval = this.store.findCandidates(current.id, query, maxEvidenceItems * 6)
    return selectProjectEvidence(retrieval.candidates, {
      commitSha: current.snapshot.commitSha,
      normalizedTerms: retrieval.normalizedTerms,
      maxEvidenceItems,
      maxEvidenceSources: maxEvidenceItems,
      maxTotalEvidenceCharacters: maxCharacters,
      maxPacketPayloadCharacters: maxCharacters + 5_000,
    }).evidence
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

  resolveProjectContextRequirement(userText: string): ProjectContextRequirement {
    return projectContextRequirement(userText)
  }

  buildContextPacket(
    userText: string,
    traceIdValue?: string,
    requestedRequirement = this.resolveProjectContextRequirement(userText),
  ): ProjectContextPacket | null {
    const traceId = safeTraceId(traceIdValue)
    const startedAt = Date.now()
    const requirement = requestedRequirement
    const relevant = requirement !== 'none'
    mainLog.info('[ProjectAwarenessTrace] relevance_gate', {
      traceId,
      relevant,
      requirement,
      queryCharacters: userText.length,
    })
    if (!relevant) {
      mainLog.info('[ProjectAwarenessTrace] terminal', {
        traceId,
        result: 'not-relevant',
        elapsedMs: Date.now() - startedAt,
      })
      return null
    }
    const current = this.currentSnapshot()
    if (!current) {
      mainLog.info('[ProjectAwarenessTrace] terminal', {
        traceId,
        result: 'snapshot-unavailable',
        elapsedMs: Date.now() - startedAt,
      })
      return null
    }
    const map = this.store.getProjectMap(current.id)
    const mapSummary = map
      ? summarizeProjectMap(map).slice(0, PROJECT_CONTEXT_BUDGET.maxMapSummaryCharacters)
      : undefined
    const retrievalStartedAt = Date.now()
    const retrieval = this.store.findCandidates(
      current.id,
      userText.trim().slice(0, 500),
      PROJECT_CONTEXT_BUDGET.candidateLimit,
    )
    const selection = selectProjectEvidence(retrieval.candidates, {
      commitSha: current.snapshot.commitSha,
      normalizedTerms: retrieval.normalizedTerms,
      reservedPacketCharacters: mapSummary?.length ?? 0,
    })
    const retrievalDurationMs = Date.now() - retrievalStartedAt
    const candidateMatchCounts = {
      symbol: 0,
      path: 0,
      technologyOverview: 0,
      fts: 0,
    }
    for (const candidate of retrieval.candidates) {
      for (const match of candidate.matches) {
        if (match.kind === 'technology-overview') candidateMatchCounts.technologyOverview += 1
        else candidateMatchCounts[match.kind] += 1
      }
    }
    mainLog.info('[ProjectAwarenessTrace] retrieval_terminal', {
      traceId,
      retrievalDurationMs,
      normalizedTermCount: retrieval.normalizedTerms.length,
      normalizedTermCharacters: retrieval.normalizedTerms.reduce(
        (characters, term) => characters + term.length,
        0,
      ),
      candidateCount: retrieval.candidates.length,
      candidateMatchCounts,
      quality: selection.quality,
      selectedEvidenceCount: selection.evidence.length,
      selectedEvidence: selection.evidence.map((item) => ({
        path: item.path,
        startLine: item.startLine,
        endLine: item.endLine,
        relevance: item.relevance,
      })),
      selectedSources: selection.selectedSources,
      totalEvidenceCharacters: selection.totalEvidenceCharacters,
      estimatedEvidenceLlmUnits: selection.estimatedEvidenceLlmUnits,
      chargedPacketCharacters: selection.chargedPacketCharacters,
      budget: PROJECT_CONTEXT_BUDGET,
    })
    if (selection.evidence.length === 0) {
      mainLog.info('[ProjectAwarenessTrace] terminal', {
        traceId,
        result: 'insufficient-evidence',
        elapsedMs: Date.now() - startedAt,
      })
      return null
    }
    mainLog.info('[ProjectAwarenessTrace] terminal', {
      traceId,
      result: 'context-ready',
      elapsedMs: Date.now() - startedAt,
    })
    return {
      requirement,
      snapshotSha: current.snapshot.commitSha,
      repository: this.config.repository,
      branch: this.config.branch,
      freshness: this.getStatus().freshness,
      mapSummary,
      evidence: selection.evidence,
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
    const current = this.currentSnapshot()
    if (!current) throw new Error(this.t('main.error.project.indexMissing'))
    return current
  }

  private currentSnapshot(): {
    id: string
    snapshot: ReturnType<ProjectKnowledgeStore['getCurrentSnapshot']> extends infer Result
      ? Result extends { snapshot: infer Snapshot }
        ? Snapshot
        : never
      : never
    fileCount: number
  } | null {
    if (this.repository) {
      return this.store.getCurrentSnapshot(this.repository, this.config.branch)
    }
    if (
      !isValidProjectRepository(this.config.repository) ||
      !isValidProjectBranch(this.config.branch)
    ) {
      return null
    }
    const { owner, name } = parseRepository(this.config.repository, this.t)
    return this.store.getCurrentSnapshotByTarget(owner, name, this.config.branch)
  }

  private async buildSnapshotDelta(
    current: ReturnType<ProjectAwarenessRuntime['currentSnapshot']>,
    remoteHead: string,
  ): Promise<ProjectSnapshotDelta | undefined> {
    if (!current || current.snapshot.commitSha === remoteHead || !this.adapter) return undefined
    try {
      return snapshotDelta(
        await this.adapter.compareCommits(current.snapshot.commitSha, remoteHead),
      )
    } catch {
      return undefined
    }
  }
}
