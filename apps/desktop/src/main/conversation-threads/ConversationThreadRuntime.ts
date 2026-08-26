import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type {
  ConversationThread,
  ConversationThreadRuntimePort,
  ConversationThreadStatus,
  OpenConversationThreadInput,
} from '../../shared/conversation-threads'

const MAX_UNFINISHED_THREADS = 8
const ACTIVE_TTL_MS = 24 * 60 * 60_000
const DORMANT_TTL_MS = 3 * 24 * 60 * 60_000

interface ConversationThreadRow {
  id: string
  topic: string
  summary: string
  status: ConversationThreadStatus
  source_turn_id: string
  created_at: number
  updated_at: number
  expires_at: number
  salience: number
}

/** Main-owned short-lived continuity store. It is neither Semantic Memory nor Goal storage. */
export class ConversationThreadRuntime implements ConversationThreadRuntimePort {
  private readonly database: DatabaseSync
  private closed = false

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.database = new DatabaseSync(path)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS conversation_threads (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        source_turn_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        salience REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversation_threads_expiry
        ON conversation_threads(expires_at);
    `)
  }

  awareness(now = Date.now()): readonly ConversationThread[] {
    this.prune(now)
    const rows = this.database
      .prepare(
        `SELECT * FROM conversation_threads
         WHERE status IN ('active', 'interrupted', 'waiting-user', 'dormant')
         ORDER BY
           CASE status
             WHEN 'waiting-user' THEN 0
             WHEN 'active' THEN 1
             WHEN 'interrupted' THEN 2
             ELSE 3
           END,
           salience DESC,
           updated_at DESC
         LIMIT 1`,
      )
      .all() as unknown as ConversationThreadRow[]
    return Object.freeze(rows.map(toThread))
  }

  open(
    input: OpenConversationThreadInput,
    sourceTurnId: string,
    now = Date.now(),
  ): ConversationThread {
    this.prune(now)
    const count = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM conversation_threads
         WHERE status IN ('active', 'interrupted', 'waiting-user', 'dormant')`,
      )
      .get() as { count: number }
    if (count.count >= MAX_UNFINISHED_THREADS) throw new Error('CONVERSATION_THREAD_LIMIT_REACHED')
    const topic = boundedRequired(input.topic, 160)
    const summary = boundedRequired(input.summary, 600)
    const status = input.status ?? 'active'
    const thread: ConversationThread = Object.freeze({
      id: `conversation-thread-${randomUUID()}`,
      topic,
      summary,
      status,
      sourceTurnId: boundedRequired(sourceTurnId, 160),
      createdAt: now,
      updatedAt: now,
      expiresAt: now + (status === 'dormant' ? DORMANT_TTL_MS : ACTIVE_TTL_MS),
      salience: boundedUnit(input.salience ?? 0.6),
    })
    this.database
      .prepare(
        `INSERT INTO conversation_threads (
           id, topic, summary, status, source_turn_id, created_at, updated_at, expires_at, salience
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        thread.id,
        thread.topic,
        thread.summary,
        thread.status,
        thread.sourceTurnId,
        thread.createdAt,
        thread.updatedAt,
        thread.expiresAt,
        thread.salience,
      )
    return thread
  }

  resolve(id: string, now = Date.now()): ConversationThread {
    this.prune(now)
    const row = this.database.prepare('SELECT * FROM conversation_threads WHERE id = ?').get(id) as
      | ConversationThreadRow
      | undefined
    if (!row) throw new Error('CONVERSATION_THREAD_NOT_FOUND')
    const resolved = Object.freeze({
      ...toThread(row),
      status: 'resolved' as const,
      updatedAt: now,
    })
    this.database.prepare('DELETE FROM conversation_threads WHERE id = ?').run(id)
    return resolved
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private prune(now: number): void {
    if (this.closed) throw new Error('CONVERSATION_THREAD_RUNTIME_CLOSED')
    this.database.prepare('DELETE FROM conversation_threads WHERE expires_at <= ?').run(now)
  }
}

function toThread(row: ConversationThreadRow): ConversationThread {
  return Object.freeze({
    id: row.id,
    topic: row.topic,
    summary: row.summary,
    status: row.status,
    sourceTurnId: row.source_turn_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    salience: row.salience,
  })
}

function boundedRequired(value: string, maximum: number): string {
  const bounded = value.trim().slice(0, maximum)
  if (!bounded) throw new Error('CONVERSATION_THREAD_INVALID')
  return bounded
}

function boundedUnit(value: number): number {
  if (!Number.isFinite(value)) throw new Error('CONVERSATION_THREAD_INVALID')
  return Math.max(0, Math.min(1, value))
}
