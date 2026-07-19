import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { DEFAULT_UI_LOCALE, type Translator, translate } from '../../shared/localization'
import type {
  ProjectEvidence,
  ProjectMap,
  ProjectRepositoryIdentity,
  ProjectSnapshotIdentity,
  ProjectSymbolReference,
} from '../../shared/project-awareness'
import type { PreparedProjectFile } from './contracts'

interface SnapshotRow {
  id: string
  branch: string
  commit_sha: string
  created_at: number
  owner: string
  name: string
  default_branch: string
}

interface SnapshotRetentionRow {
  id: string
  is_current: number
}

export interface StoredProjectFile {
  id: number
  snapshot_id: string
  path: string
  blob_sha: string
  language: PreparedProjectFile['language']
  content_hash: string
  size: number
  priority: number
  imports_json: string
  content: string
}

export interface StoredProjectSymbol {
  name: string
  kind: ProjectSymbolReference['kind']
  exported: number
  start_line: number
  end_line: number
  signature: string | null
  path?: string
}

interface ChunkRow {
  id: number
  path: string
  start_line: number
  end_line: number
  symbol_name: string | null
  content: string
}

function repositoryId(repository: ProjectRepositoryIdentity): string {
  return `${repository.provider}:${repository.owner}/${repository.name}`
}

function snapshotFromRow(row: SnapshotRow): ProjectSnapshotIdentity {
  return {
    repository: {
      provider: 'github',
      owner: row.owner,
      name: row.name,
      defaultBranch: row.default_branch,
    },
    branch: row.branch,
    commitSha: row.commit_sha,
    createdAt: row.created_at,
  }
}

function ftsQuery(query: string): string | null {
  const terms = query
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_./-]{2,}/gu)
    ?.slice(0, 12)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
  return terms?.length ? terms.join(' OR ') : null
}

export class ProjectKnowledgeStore {
  private readonly database: DatabaseSync

  constructor(
    databasePath: string,
    private readonly t: Translator = (key, params) => translate(DEFAULT_UI_LOCALE, key, params),
  ) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
    this.migrate()
  }

  close(): void {
    this.database.close()
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        branch TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 0,
        UNIQUE(repository_id, branch, commit_sha)
      );
      CREATE INDEX IF NOT EXISTS snapshots_current
        ON snapshots(repository_id, branch, is_current);
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        blob_sha TEXT NOT NULL,
        language TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        summary TEXT,
        size INTEGER NOT NULL,
        priority INTEGER NOT NULL,
        imports_json TEXT NOT NULL,
        content TEXT NOT NULL,
        UNIQUE(snapshot_id, path)
      );
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        exported INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        signature TEXT
      );
      CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name);
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        symbol_name TEXT,
        content TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        chunk_id UNINDEXED,
        snapshot_id UNINDEXED,
        path,
        symbol_name,
        content,
        tokenize = 'unicode61'
      );
      CREATE TABLE IF NOT EXISTS file_summaries (
        file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_maps (
        snapshot_id TEXT PRIMARY KEY REFERENCES snapshots(id) ON DELETE CASCADE,
        map_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        from_sha TEXT,
        to_sha TEXT,
        state TEXT NOT NULL,
        changed_files INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS recent_commits (
        repository_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        sha TEXT NOT NULL,
        message TEXT NOT NULL,
        authored_at INTEGER NOT NULL,
        changed_files_json TEXT NOT NULL,
        PRIMARY KEY(repository_id, branch, sha)
      );
      DELETE FROM chunks_fts
      WHERE CAST(chunk_id AS INTEGER) NOT IN (SELECT id FROM chunks);
    `)
  }

  beginSync(
    repository: ProjectRepositoryIdentity,
    branch: string,
    fromSha: string | undefined,
    toSha: string,
  ): number {
    this.upsertRepository(repository)
    const result = this.database
      .prepare(
        `INSERT INTO sync_runs
          (repository_id, branch, from_sha, to_sha, state, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)`,
      )
      .run(repositoryId(repository), branch, fromSha ?? null, toSha, Date.now())
    return Number(result.lastInsertRowid)
  }

  finishSync(
    runId: number,
    state: 'completed' | 'error',
    changedFiles: number,
    error?: string,
  ): void {
    this.database
      .prepare(
        `UPDATE sync_runs
         SET state = ?, changed_files = ?, completed_at = ?, error = ?
         WHERE id = ?`,
      )
      .run(state, changedFiles, Date.now(), error ?? null, runId)
  }

  private upsertRepository(repository: ProjectRepositoryIdentity): void {
    this.database
      .prepare(
        `INSERT INTO repositories (id, provider, owner, name, default_branch, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           default_branch = excluded.default_branch,
           updated_at = excluded.updated_at`,
      )
      .run(
        repositoryId(repository),
        repository.provider,
        repository.owner,
        repository.name,
        repository.defaultBranch,
        Date.now(),
      )
  }

  getCurrentSnapshot(
    repository: ProjectRepositoryIdentity,
    branch: string,
  ): { id: string; snapshot: ProjectSnapshotIdentity; fileCount: number } | null {
    const row = this.database
      .prepare(
        `SELECT s.id, s.branch, s.commit_sha, s.created_at, r.owner, r.name, r.default_branch,
          (SELECT COUNT(*) FROM files f WHERE f.snapshot_id = s.id) AS file_count
         FROM snapshots s
         JOIN repositories r ON r.id = s.repository_id
         WHERE s.repository_id = ? AND s.branch = ? AND s.is_current = 1
         LIMIT 1`,
      )
      .get(repositoryId(repository), branch) as (SnapshotRow & { file_count: number }) | undefined
    if (!row) return null
    return { id: row.id, snapshot: snapshotFromRow(row), fileCount: row.file_count }
  }

  createDraftSnapshot(input: {
    repository: ProjectRepositoryIdentity
    branch: string
    commitSha: string
    previousSnapshotId?: string
    excludedPreviousPaths: ReadonlySet<string>
    files: PreparedProjectFile[]
  }): { id: string; fileCount: number } {
    this.upsertRepository(input.repository)
    const id = `${repositoryId(input.repository)}:${input.branch}:${input.commitSha}`
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database
        .prepare(
          `DELETE FROM chunks_fts
           WHERE CAST(chunk_id AS INTEGER) IN (
             SELECT c.id
             FROM chunks c
             JOIN files f ON f.id = c.file_id
             JOIN snapshots s ON s.id = f.snapshot_id
             WHERE s.repository_id = ? AND s.branch = ? AND s.commit_sha = ?
           )`,
        )
        .run(repositoryId(input.repository), input.branch, input.commitSha)
      this.database
        .prepare('DELETE FROM snapshots WHERE repository_id = ? AND branch = ? AND commit_sha = ?')
        .run(repositoryId(input.repository), input.branch, input.commitSha)
      this.database
        .prepare(
          `INSERT INTO snapshots
            (id, repository_id, branch, commit_sha, created_at, is_current)
           VALUES (?, ?, ?, ?, ?, 0)`,
        )
        .run(id, repositoryId(input.repository), input.branch, input.commitSha, Date.now())

      if (input.previousSnapshotId) {
        const previousFiles = this.database
          .prepare('SELECT * FROM files WHERE snapshot_id = ? ORDER BY id')
          .all(input.previousSnapshotId) as unknown as StoredProjectFile[]
        for (const file of previousFiles) {
          if (input.excludedPreviousPaths.has(file.path)) continue
          const symbols = this.database
            .prepare(
              `SELECT name, kind, exported, start_line, end_line, signature
               FROM symbols WHERE file_id = ? ORDER BY start_line`,
            )
            .all(file.id) as unknown as StoredProjectSymbol[]
          const chunks = this.database
            .prepare(
              `SELECT id, '' AS path, start_line, end_line, symbol_name, content
               FROM chunks WHERE file_id = ? ORDER BY start_line`,
            )
            .all(file.id) as unknown as ChunkRow[]
          this.insertFile(id, {
            path: file.path,
            blobSha: file.blob_sha,
            language: file.language,
            contentHash: file.content_hash,
            size: file.size,
            priority: file.priority,
            content: file.content,
            imports: JSON.parse(file.imports_json) as string[],
            symbols: symbols.map((symbol) => ({
              name: symbol.name,
              kind: symbol.kind,
              exported: Boolean(symbol.exported),
              startLine: symbol.start_line,
              endLine: symbol.end_line,
              signature: symbol.signature,
            })),
            chunks: chunks.map((chunk) => ({
              startLine: chunk.start_line,
              endLine: chunk.end_line,
              symbolName: chunk.symbol_name,
              content: chunk.content,
            })),
          })
        }
      }

      for (const file of input.files) this.insertFile(id, file)
      const countRow = this.database
        .prepare('SELECT COUNT(*) AS count FROM files WHERE snapshot_id = ?')
        .get(id) as { count: number }
      this.database.exec('COMMIT')
      return { id, fileCount: countRow.count }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private insertFile(snapshotId: string, file: PreparedProjectFile): void {
    const result = this.database
      .prepare(
        `INSERT INTO files
          (snapshot_id, path, blob_sha, language, content_hash, summary, size, priority, imports_json, content)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        snapshotId,
        file.path,
        file.blobSha,
        file.language,
        file.contentHash,
        file.size,
        file.priority,
        JSON.stringify(file.imports),
        file.content,
      )
    const fileId = Number(result.lastInsertRowid)
    const insertSymbol = this.database.prepare(
      `INSERT INTO symbols
        (file_id, name, kind, exported, start_line, end_line, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const symbol of file.symbols) {
      insertSymbol.run(
        fileId,
        symbol.name,
        symbol.kind,
        symbol.exported ? 1 : 0,
        symbol.startLine,
        symbol.endLine,
        symbol.signature,
      )
    }
    const insertChunk = this.database.prepare(
      `INSERT INTO chunks (file_id, start_line, end_line, symbol_name, content)
       VALUES (?, ?, ?, ?, ?)`,
    )
    const insertFts = this.database.prepare(
      `INSERT INTO chunks_fts
        (chunk_id, snapshot_id, path, symbol_name, content)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (const chunk of file.chunks) {
      const chunkResult = insertChunk.run(
        fileId,
        chunk.startLine,
        chunk.endLine,
        chunk.symbolName,
        chunk.content,
      )
      insertFts.run(
        Number(chunkResult.lastInsertRowid),
        snapshotId,
        file.path,
        chunk.symbolName ?? '',
        chunk.content,
      )
    }
  }

  publishSnapshot(repository: ProjectRepositoryIdentity, branch: string, snapshotId: string): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database
        .prepare('UPDATE snapshots SET is_current = 0 WHERE repository_id = ? AND branch = ?')
        .run(repositoryId(repository), branch)
      this.database.prepare('UPDATE snapshots SET is_current = 1 WHERE id = ?').run(snapshotId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  pruneSnapshots(repository: ProjectRepositoryIdentity, branch: string, keepCount: number): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const snapshots = this.database
        .prepare(
          `SELECT id, is_current
           FROM snapshots
           WHERE repository_id = ? AND branch = ?
           ORDER BY is_current DESC, created_at DESC, rowid DESC`,
        )
        .all(repositoryId(repository), branch) as unknown as SnapshotRetentionRow[]
      const retainedIds = new Set(
        snapshots.filter((snapshot) => snapshot.is_current === 1).map((snapshot) => snapshot.id),
      )
      const retentionLimit = Math.max(1, Math.floor(keepCount))
      for (const snapshot of snapshots) {
        if (retainedIds.size >= retentionLimit) break
        retainedIds.add(snapshot.id)
      }

      const removeFts = this.database.prepare('DELETE FROM chunks_fts WHERE snapshot_id = ?')
      const removeSnapshot = this.database.prepare(
        'DELETE FROM snapshots WHERE id = ? AND is_current = 0',
      )
      for (const snapshot of snapshots) {
        if (snapshot.is_current === 1 || retainedIds.has(snapshot.id)) continue
        removeFts.run(snapshot.id)
        removeSnapshot.run(snapshot.id)
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  deleteDraftSnapshot(snapshotId: string): void {
    const chunkIds = this.database
      .prepare(
        `SELECT c.id
         FROM chunks c JOIN files f ON f.id = c.file_id
         WHERE f.snapshot_id = ?`,
      )
      .all(snapshotId) as unknown as Array<{ id: number }>
    const removeFts = this.database.prepare('DELETE FROM chunks_fts WHERE chunk_id = ?')
    for (const chunk of chunkIds) removeFts.run(chunk.id)
    this.database.prepare('DELETE FROM snapshots WHERE id = ? AND is_current = 0').run(snapshotId)
  }

  listFiles(snapshotId: string): StoredProjectFile[] {
    return this.database
      .prepare('SELECT * FROM files WHERE snapshot_id = ? ORDER BY priority DESC, path')
      .all(snapshotId) as unknown as StoredProjectFile[]
  }

  listSymbols(snapshotId: string): Array<StoredProjectSymbol & { path: string }> {
    return this.database
      .prepare(
        `SELECT s.name, s.kind, s.exported, s.start_line, s.end_line, s.signature, f.path
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE f.snapshot_id = ?
         ORDER BY s.exported DESC, f.priority DESC, f.path, s.start_line`,
      )
      .all(snapshotId) as unknown as Array<StoredProjectSymbol & { path: string }>
  }

  saveProjectMap(snapshotId: string, map: ProjectMap): void {
    this.database
      .prepare(
        `INSERT INTO project_maps (snapshot_id, map_json, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(snapshot_id) DO UPDATE SET
           map_json = excluded.map_json,
           created_at = excluded.created_at`,
      )
      .run(snapshotId, JSON.stringify(map), Date.now())
  }

  getProjectMap(snapshotId: string): ProjectMap | null {
    const row = this.database
      .prepare('SELECT map_json FROM project_maps WHERE snapshot_id = ?')
      .get(snapshotId) as { map_json: string } | undefined
    return row ? (JSON.parse(row.map_json) as ProjectMap) : null
  }

  search(
    snapshotId: string,
    commitSha: string,
    query: string,
    limit: number,
    maxCharacters: number,
  ): ProjectEvidence[] {
    const ranked = new Map<number, { row: ChunkRow; relevance: number }>()
    const add = (rows: ChunkRow[], relevance: number): void => {
      for (const row of rows) {
        const existing = ranked.get(row.id)
        if (!existing || existing.relevance < relevance) ranked.set(row.id, { row, relevance })
      }
    }
    const symbolRows = this.database
      .prepare(
        `SELECT c.id, f.path, c.start_line, c.end_line, c.symbol_name, c.content
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         JOIN chunks c ON c.file_id = f.id
         WHERE f.snapshot_id = ? AND lower(s.name) = lower(?) AND c.symbol_name = s.name
         LIMIT ?`,
      )
      .all(snapshotId, query.trim(), limit) as unknown as ChunkRow[]
    add(symbolRows, 1)
    const pathRows = this.database
      .prepare(
        `SELECT c.id, f.path, c.start_line, c.end_line, c.symbol_name, c.content
         FROM chunks c JOIN files f ON f.id = c.file_id
         WHERE f.snapshot_id = ? AND lower(f.path) LIKE lower(?)
         ORDER BY f.priority DESC, c.start_line
         LIMIT ?`,
      )
      .all(snapshotId, `%${query.trim().slice(0, 200)}%`, limit) as unknown as ChunkRow[]
    add(pathRows, 0.9)
    const match = ftsQuery(query)
    if (match) {
      const ftsRows = this.database
        .prepare(
          `SELECT CAST(chunk_id AS INTEGER) AS id, path, 0 AS start_line, 0 AS end_line,
             NULLIF(symbol_name, '') AS symbol_name, content
           FROM chunks_fts
           WHERE snapshot_id = ? AND chunks_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(snapshotId, match, limit * 3) as unknown as ChunkRow[]
      const hydrate = this.database.prepare(
        `SELECT c.id, f.path, c.start_line, c.end_line, c.symbol_name, c.content
         FROM chunks c JOIN files f ON f.id = c.file_id WHERE c.id = ?`,
      )
      add(
        ftsRows.flatMap((row) => {
          const full = hydrate.get(row.id) as ChunkRow | undefined
          return full ? [full] : []
        }),
        0.72,
      )
    }

    let usedCharacters = 0
    return [...ranked.values()]
      .sort(
        (left, right) =>
          right.relevance - left.relevance ||
          left.row.path.localeCompare(right.row.path) ||
          left.row.start_line - right.row.start_line,
      )
      .flatMap(({ row, relevance }) => {
        if (usedCharacters >= maxCharacters) return []
        const remaining = maxCharacters - usedCharacters
        const content = row.content.slice(0, remaining)
        usedCharacters += content.length
        return [
          {
            path: row.path,
            startLine: row.start_line,
            endLine: row.end_line,
            ...(row.symbol_name ? { symbol: row.symbol_name } : {}),
            commitSha,
            content,
            relevance,
          },
        ]
      })
      .slice(0, limit)
  }

  readFile(
    snapshotId: string,
    commitSha: string,
    path: string,
    startLine = 1,
    endLine?: number,
  ): ProjectEvidence {
    const row = this.database
      .prepare('SELECT content FROM files WHERE snapshot_id = ? AND path = ?')
      .get(snapshotId, path) as { content: string } | undefined
    if (!row) throw new Error(this.t('main.error.project.fileNotIndexed', { path }))
    const lines = row.content.split(/\r?\n/)
    const safeStart = Math.max(1, Math.min(lines.length || 1, Math.floor(startLine)))
    const safeEnd = Math.max(
      safeStart,
      Math.min(lines.length, Math.floor(endLine ?? safeStart + 219), safeStart + 219),
    )
    return {
      path,
      startLine: safeStart,
      endLine: safeEnd,
      commitSha,
      content: lines.slice(safeStart - 1, safeEnd).join('\n'),
      relevance: 1,
    }
  }

  readSymbol(snapshotId: string, commitSha: string, name: string, path?: string): ProjectEvidence {
    const row = this.database
      .prepare(
        `SELECT f.path, s.name, s.start_line, s.end_line, f.content
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE f.snapshot_id = ? AND lower(s.name) = lower(?)
           AND (? IS NULL OR f.path = ?)
         ORDER BY s.exported DESC, f.priority DESC
         LIMIT 1`,
      )
      .get(snapshotId, name, path ?? null, path ?? null) as
      | {
          path: string
          name: string
          start_line: number
          end_line: number
          content: string
        }
      | undefined
    if (!row) throw new Error(this.t('main.error.project.symbolNotIndexed', { name }))
    const lines = row.content.split(/\r?\n/)
    return {
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      symbol: row.name,
      commitSha,
      content: lines
        .slice(row.start_line - 1, row.end_line)
        .join('\n')
        .slice(0, 16_000),
      relevance: 1,
    }
  }

  saveRecentCommit(input: {
    repository: ProjectRepositoryIdentity
    branch: string
    sha: string
    message: string
    authoredAt: number
    changedFiles: string[]
  }): void {
    this.database
      .prepare(
        `INSERT INTO recent_commits
          (repository_id, branch, sha, message, authored_at, changed_files_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(repository_id, branch, sha) DO UPDATE SET
           message = excluded.message,
           authored_at = excluded.authored_at,
           changed_files_json = excluded.changed_files_json`,
      )
      .run(
        repositoryId(input.repository),
        input.branch,
        input.sha,
        input.message,
        input.authoredAt,
        JSON.stringify(input.changedFiles),
      )
  }

  pruneRecentCommits(repository: ProjectRepositoryIdentity, branch: string, keep: number): void {
    this.database
      .prepare(
        `DELETE FROM recent_commits
         WHERE repository_id = ? AND branch = ? AND sha NOT IN (
           SELECT sha FROM recent_commits
           WHERE repository_id = ? AND branch = ?
           ORDER BY authored_at DESC
           LIMIT ?
         )`,
      )
      .run(repositoryId(repository), branch, repositoryId(repository), branch, Math.max(1, keep))
  }
}
