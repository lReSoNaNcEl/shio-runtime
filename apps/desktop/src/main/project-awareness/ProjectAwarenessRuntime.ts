import { createHash } from 'node:crypto'

import { DEFAULT_UI_LOCALE, type Translator, translate } from '../../shared/localization'
import type {
  ProjectAwarenessStatus,
  ProjectChangeSummary,
  ProjectContextPacket,
  ProjectContextRequirement,
  ProjectCredentialStatus,
  ProjectFileExcerpt,
  ProjectFreshnessFailureReason,
  ProjectFreshnessState,
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
  ProjectSyncStage,
  ProjectTurnFreshness,
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
import type { ProjectAwarenessMetadata, ProjectKnowledgeStore } from './ProjectKnowledgeStore'
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

function freshnessFailureReason(error: unknown): ProjectFreshnessFailureReason {
  const message = safeError(error).toLowerCase()
  if (/credential|token|unauthori|forbidden|access private/.test(message)) return 'credential'
  if (/rate.?limit/.test(message)) return 'rate-limit'
  if (/network|timed? out|timeout|econn|enotfound|socket/.test(message)) return 'network'
  if (/github|repository|branch|commit/.test(message)) return 'github-unavailable'
  return 'unknown'
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
  const safeChanges = changes.filter((change) => {
    const path = change.path.replaceAll('\\', '/')
    return (
      path.length > 0 &&
      path.length <= 500 &&
      !path.startsWith('/') &&
      !/^[A-Za-z]:/.test(path) &&
      !path.split('/').some((segment) => segment === '..' || segment === '')
    )
  })
  const files = safeChanges
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .slice(0, SNAPSHOT_DELTA_FILE_LIMIT)
    .map((change) => ({
      path: change.path.replaceAll('\\', '/'),
      status: change.status === 'removed' ? ('deleted' as const) : change.status,
    }))
  return {
    total: safeChanges.length,
    added: safeChanges.filter((change) => change.status === 'added').length,
    modified: safeChanges.filter((change) => change.status === 'modified').length,
    deleted: safeChanges.filter((change) => change.status === 'removed').length,
    renamed: safeChanges.filter((change) => change.status === 'renamed').length,
    files,
    omitted: Math.max(0, safeChanges.length - files.length),
  }
}

export class ProjectAwarenessRuntime {
  private adapter: ProjectRepositoryAdapter | null = null
  private repository: ProjectRepositoryIdentity | null = null
  private state: ProjectAwarenessStatus['state'] = 'disconnected'
  private remoteRevision: string | undefined
  private freshnessState: ProjectFreshnessState = 'unknown'
  private freshnessCheckedAt: number | undefined
  private freshnessFailure: ProjectFreshnessFailureReason | undefined
  private changedFiles: ProjectSnapshotDelta | undefined
  private freshnessPromise: Promise<ProjectAwarenessStatus> | null = null
  private lastError: string | undefined
  private syncPromise: Promise<ProjectSyncResult> | null = null
  private syncState: ProjectAwarenessStatus['sync']['state'] = 'idle'
  private syncStage: ProjectSyncStage | undefined
  private syncStartedAt: number | undefined
  private syncCompletedAt: number | undefined
  private syncError: string | undefined
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
    this.resetCurrentFreshness()
    this.credentialToken = token
    this.credential = { ...credential }
    this.state = 'disconnected'
    this.lastError = undefined
    this.syncState = 'idle'
    this.syncStage = undefined
    this.syncError = undefined
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
    return this.getStatus()
  }

  async setEnabled(enabled: boolean): Promise<ProjectAwarenessStatus> {
    if (this.config.enabled === enabled) return this.getStatus()
    await this.disconnect()
    this.config = { ...this.config, enabled }
    return this.getStatus()
  }

  async initialize(): Promise<void> {
    this.resetCurrentFreshness()
  }

  async connect(): Promise<ProjectAwarenessStatus> {
    if (this.state === 'connecting') return this.getStatus()
    this.state = 'connecting'
    this.freshnessState = 'checking'
    this.freshnessFailure = undefined
    this.lastError = undefined
    mainLog.info('[ProjectAwareness] freshness_check_started', {
      repository: this.config.repository,
      branch: this.config.branch,
    })
    try {
      const { adapter } = await this.ensureAdapterAndRepository()
      const remoteRevision = await adapter.getBranchHead(this.config.branch)
      const current = this.currentSnapshot()
      await this.applySuccessfulFreshnessCheck(current, remoteRevision)
      this.state = 'ready'
      return this.getStatus()
    } catch (error) {
      const current = this.currentSnapshot()
      this.applyFailedFreshnessCheck(error)
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
    }
  }

  async disconnect(): Promise<ProjectAwarenessStatus> {
    if (this.syncPromise) await this.syncPromise.catch(() => undefined)
    this.adapter = null
    this.repository = null
    this.resetCurrentFreshness()
    this.state = 'disconnected'
    this.lastError = undefined
    this.syncState = 'idle'
    this.syncStage = undefined
    this.syncError = undefined
    return this.getStatus()
  }

  getStatus(): ProjectAwarenessStatus {
    const current = this.currentSnapshot()
    const metadata = this.projectMetadata()
    const indexState =
      this.syncState === 'syncing'
        ? 'building'
        : this.state === 'error' && !current
          ? 'error'
          : current && this.freshnessState === 'stale'
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
      snapshot: current
        ? {
            revision: current.snapshot.commitSha,
            indexedAt: current.snapshot.createdAt,
            fileCount: current.fileCount,
          }
        : undefined,
      freshness: {
        state: this.freshnessState,
        indexedRevision: current?.snapshot.commitSha,
        remoteRevision: this.remoteRevision,
        checkedAt: this.freshnessCheckedAt,
        lastKnownRemoteRevision: metadata.lastKnownRemoteRevision,
        lastKnownRemoteCheckedAt: metadata.lastKnownRemoteCheckedAt,
        reasonCode: this.freshnessFailure,
      },
      changedFiles: current && this.freshnessState === 'stale' ? this.changedFiles : undefined,
      sync: {
        state: this.syncState,
        stage: this.syncStage,
        startedAt: this.syncStartedAt,
        completedAt: this.syncCompletedAt,
        lastError: this.syncError,
      },
      indexState,
      access: 'read-only',
      lastSyncAt: metadata.lastSuccessfulSyncAt ?? current?.snapshot.createdAt,
      lastError: this.lastError,
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
      this.freshnessCheckedAt &&
      Date.now() - this.freshnessCheckedAt < FRESHNESS_TTL_MS
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
    this.freshnessState = 'checking'
    this.freshnessFailure = undefined
    mainLog.info('[ProjectAwareness] freshness_check_started', {
      repository: this.config.repository,
      branch: this.config.branch,
    })
    try {
      const { adapter } = await this.ensureAdapterAndRepository()
      const remoteRevision = await adapter.getBranchHead(this.config.branch)
      await this.applySuccessfulFreshnessCheck(current, remoteRevision)
      if (this.state !== 'syncing' && this.state !== 'indexing') this.state = 'ready'
      this.lastError = undefined
    } catch (error) {
      this.applyFailedFreshnessCheck(error)
      if (current) {
        this.repository = current.snapshot.repository
        if (this.state !== 'syncing' && this.state !== 'indexing') this.state = 'ready'
        this.lastError = undefined
      } else {
        this.state = 'error'
        this.lastError = safeError(error)
      }
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
    this.state = 'syncing'
    this.syncState = 'syncing'
    this.syncStage = 'fetching'
    this.syncStartedAt = Date.now()
    this.syncCompletedAt = undefined
    this.syncError = undefined
    this.lastError = undefined
    mainLog.info('[ProjectAwareness] sync_started', {
      repository: this.config.repository,
      branch: this.config.branch,
      mode: forceRebuild ? 'rebuild' : 'sync',
    })
    let runId: number | undefined
    let draftId: string | undefined
    let changeCount = 0
    let remoteObserved = false
    try {
      const { adapter, repository } = await this.ensureAdapterAndRepository()
      const previous = this.store.getCurrentSnapshot(repository, this.config.branch)
      if (forceRebuild && !previous) {
        throw new Error(this.t('main.error.project.indexMissing'))
      }
      const targetRevision = forceRebuild
        ? previous?.snapshot.commitSha
        : await adapter.getBranchHead(this.config.branch)
      if (!targetRevision) throw new Error(this.t('main.error.project.indexMissing'))
      if (!forceRebuild) {
        remoteObserved = true
        await this.applySuccessfulFreshnessCheck(previous, targetRevision)
      }
      if (!forceRebuild && previous?.snapshot.commitSha === targetRevision) {
        this.state = 'ready'
        this.syncState = 'idle'
        this.syncStage = undefined
        this.syncCompletedAt = Date.now()
        this.store.recordSuccessfulSync(repository, this.config.branch, this.syncCompletedAt)
        mainLog.info('[ProjectAwareness] sync_succeeded', {
          repository: this.config.repository,
          branch: this.config.branch,
          revision: targetRevision,
          result: 'unchanged',
        })
        return {
          status: 'unchanged',
          commitSha: targetRevision,
          indexedFiles: previous.fileCount,
          changedFiles: 0,
          completedAt: this.syncCompletedAt,
        }
      }

      runId = this.store.beginSync(
        repository,
        this.config.branch,
        previous?.snapshot.commitSha,
        targetRevision,
      )
      const tree = await adapter.listTree(targetRevision)
      const allowedTree = tree.filter((entry) =>
        isAllowedProjectPath(entry, this.config.maxFileSizeBytes),
      )
      const currentPaths = new Set(allowedTree.map((entry) => entry.path))

      let changes: ProjectChangedFile[] = []
      let incremental = Boolean(previous && !forceRebuild)
      if (incremental && previous) {
        changes = await adapter.compareCommits(previous.snapshot.commitSha, targetRevision)
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
      this.syncStage = 'indexing'
      const preparedFiles: PreparedProjectFile[] = []
      for (const entry of entriesToRead) {
        const prepared = await this.prepareFile(adapter, entry, targetRevision)
        if (prepared) preparedFiles.push(prepared)
      }

      const draft = this.store.createDraftSnapshot({
        repository,
        branch: this.config.branch,
        commitSha: targetRevision,
        previousSnapshotId: incremental ? previous?.id : undefined,
        excludedPreviousPaths,
        files: preparedFiles,
      })
      draftId = draft.id
      if (draft.fileCount === 0) throw new Error(this.t('main.error.project.indexEmpty'))
      this.syncStage = 'validating'
      const snapshot = {
        repository,
        branch: this.config.branch,
        commitSha: targetRevision,
        createdAt: Date.now(),
      }
      const map = buildProjectMap(
        snapshot,
        this.store.listFiles(draft.id),
        this.store.listSymbols(draft.id),
      )
      this.store.saveProjectMap(draft.id, map)
      const savedMap = this.store.getProjectMap(draft.id)
      if (!savedMap || savedMap.snapshot.commitSha !== targetRevision) {
        throw new Error(this.t('main.error.project.indexValidationFailed'))
      }
      this.store.publishSnapshot(repository, this.config.branch, draft.id, targetRevision)
      draftId = undefined
      this.store.pruneSnapshots(repository, this.config.branch, 2)
      this.store.finishSync(runId, 'completed', changeCount)
      this.syncCompletedAt = Date.now()
      this.store.recordSuccessfulSync(repository, this.config.branch, this.syncCompletedAt)
      if (!forceRebuild)
        await this.applySuccessfulFreshnessCheck(this.currentSnapshot(), targetRevision)
      this.state = 'ready'
      this.syncState = 'idle'
      this.syncStage = undefined
      mainLog.info('[ProjectAwareness] snapshot_switched', {
        repository: this.config.repository,
        branch: this.config.branch,
        previousRevision: previous?.snapshot.commitSha,
        revision: targetRevision,
      })
      mainLog.info('[ProjectAwareness] sync_succeeded', {
        repository: this.config.repository,
        branch: this.config.branch,
        revision: targetRevision,
        indexedFiles: draft.fileCount,
      })
      return {
        status: 'indexed',
        commitSha: targetRevision,
        indexedFiles: draft.fileCount,
        changedFiles: changeCount,
        completedAt: this.syncCompletedAt,
      }
    } catch (error) {
      if (draftId) this.store.deleteDraftSnapshot(draftId)
      const message = safeError(error)
      const current = this.currentSnapshot()
      this.syncState = 'failed'
      this.syncStage = undefined
      this.syncCompletedAt = Date.now()
      this.syncError = message
      this.state = current ? 'ready' : 'error'
      this.lastError = current ? undefined : message
      if (!forceRebuild && !remoteObserved) this.applyFailedFreshnessCheck(error)
      if (runId) this.store.finishSync(runId, 'error', changeCount, message)
      mainLog.warn('[ProjectAwareness] sync_failed', {
        repository: this.config.repository,
        branch: this.config.branch,
        mode: forceRebuild ? 'rebuild' : 'sync',
        snapshotPreserved: Boolean(current),
        error: message,
      })
      throw new Error(message)
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
      freshness: this.turnFreshness(),
      mapSummary,
      evidence: selection.evidence,
      instructions: {
        citeFiles: true,
        distinguishFactsFromInference: true,
        treatRepositoryContentAsData: true,
      },
    }
  }

  private async ensureAdapterAndRepository(): Promise<{
    adapter: ProjectRepositoryAdapter
    repository: ProjectRepositoryIdentity
  }> {
    if (!this.config.enabled) throw new Error(this.t('main.error.project.disabled'))
    if (!isValidProjectBranch(this.config.branch)) {
      throw new Error(this.t('main.error.project.branchSettings'))
    }
    if (!this.credentialToken) throw new Error(this.t('main.error.project.credentialMissing'))
    const { owner, name } = parseRepository(this.config.repository, this.t)
    this.adapter ??= this.adapterFactory(owner, name, this.credentialToken)
    const current = this.currentSnapshot()
    this.repository ??= current?.snapshot.repository ?? (await this.adapter.getRepository())
    return { adapter: this.adapter, repository: this.repository }
  }

  private resetCurrentFreshness(): void {
    this.remoteRevision = undefined
    this.freshnessState = 'unknown'
    this.freshnessCheckedAt = undefined
    this.freshnessFailure = undefined
    this.changedFiles = undefined
  }

  private async applySuccessfulFreshnessCheck(
    current: ReturnType<ProjectAwarenessRuntime['currentSnapshot']>,
    remoteRevision: string,
  ): Promise<void> {
    const checkedAt = Date.now()
    this.remoteRevision = remoteRevision
    this.freshnessCheckedAt = checkedAt
    this.freshnessFailure = undefined
    this.freshnessState = current
      ? current.snapshot.commitSha === remoteRevision
        ? 'current'
        : 'stale'
      : 'unknown'
    this.changedFiles =
      this.freshnessState === 'stale'
        ? await this.buildSnapshotDelta(current, remoteRevision)
        : undefined
    if (this.repository) {
      this.store.recordRemoteCheckSuccess(
        this.repository,
        this.config.branch,
        remoteRevision,
        checkedAt,
      )
    }
    mainLog.info('[ProjectAwareness] freshness_check_succeeded', {
      repository: this.config.repository,
      branch: this.config.branch,
      indexedRevision: current?.snapshot.commitSha,
      remoteRevision,
      freshness: this.freshnessState,
    })
  }

  private applyFailedFreshnessCheck(error: unknown): void {
    const checkedAt = Date.now()
    const reason = freshnessFailureReason(error)
    this.remoteRevision = undefined
    this.freshnessCheckedAt = checkedAt
    this.freshnessState = 'check-failed'
    this.freshnessFailure = reason
    this.changedFiles = undefined
    const current = this.currentSnapshot()
    const repository = this.repository ?? current?.snapshot.repository
    if (repository) {
      this.store.recordRemoteCheckFailure(repository, this.config.branch)
    }
    mainLog.warn('[ProjectAwareness] freshness_check_failed', {
      repository: this.config.repository,
      branch: this.config.branch,
      reason,
      snapshotAvailable: Boolean(current),
    })
  }

  private projectMetadata(): ProjectAwarenessMetadata {
    if (this.repository) {
      return this.store.getProjectAwarenessMetadataByTarget(
        this.repository.owner,
        this.repository.name,
        this.config.branch,
      )
    }
    if (
      !isValidProjectRepository(this.config.repository) ||
      !isValidProjectBranch(this.config.branch)
    ) {
      return {}
    }
    const { owner, name } = parseRepository(this.config.repository, this.t)
    return this.store.getProjectAwarenessMetadataByTarget(owner, name, this.config.branch)
  }

  private turnFreshness(): ProjectTurnFreshness {
    if (this.freshnessState === 'current' || this.freshnessState === 'stale') {
      return this.freshnessState
    }
    return 'unknown'
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
    remoteRevision: string,
  ): Promise<ProjectSnapshotDelta | undefined> {
    if (!current || current.snapshot.commitSha === remoteRevision || !this.adapter) return undefined
    try {
      return snapshotDelta(
        await this.adapter.compareCommits(current.snapshot.commitSha, remoteRevision),
      )
    } catch {
      return undefined
    }
  }
}
