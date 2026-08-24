import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { MemoryKind, MemoryRecord, MemorySource } from '../../shared/memory'

interface MemoryRow {
  id: string
  kind: MemoryKind
  text: string
  source_type: MemorySource['type']
  source_turn_id: string | null
  created_at: number
  updated_at: number
}

export interface NewMemoryRecord {
  kind: MemoryKind
  text: string
  source: MemorySource
}

export interface SemanticMemoryStore {
  close(): void
  getEnabled(): boolean
  setEnabled(enabled: boolean): void
  count(): number
  getById(id: string): MemoryRecord | null
  insertMany(records: readonly NewMemoryRecord[]): readonly MemoryRecord[]
  update(
    id: string,
    changes: { kind?: MemoryKind; text?: string; source?: MemorySource },
  ): MemoryRecord | null
  deleteMany(ids: readonly string[]): readonly string[]
  list(kind: MemoryKind | undefined, limit: number): readonly MemoryRecord[]
  searchLexical(expression: string, limit: number): readonly MemoryRecord[]
  clear(): void
}

function toRecord(row: MemoryRow): MemoryRecord {
  return Object.freeze({
    id: row.id,
    kind: row.kind,
    text: row.text,
    source: Object.freeze({
      type: row.source_type,
      ...(row.source_turn_id ? { turnId: row.source_turn_id } : {}),
    }),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  })
}

export class SqliteSemanticMemoryStore implements SemanticMemoryStore {
  private readonly database: DatabaseSync

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
    this.migrate()
  }

  close(): void {
    this.database.close()
  }

  getEnabled(): boolean {
    const row = this.database
      .prepare("SELECT value FROM memory_settings WHERE key = 'enabled'")
      .get() as { value: string } | undefined
    return row?.value !== 'false'
  }

  setEnabled(enabled: boolean): void {
    this.database
      .prepare(
        `INSERT INTO memory_settings (key, value)
         VALUES ('enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(enabled ? 'true' : 'false')
  }

  count(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM memory_records').get() as {
      count: number
    }
    return Number(row.count)
  }

  getById(id: string): MemoryRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, kind, text, source_type, source_turn_id, created_at, updated_at
         FROM memory_records WHERE id = ?`,
      )
      .get(id) as MemoryRow | undefined
    return row ? toRecord(row) : null
  }

  insertMany(records: readonly NewMemoryRecord[]): readonly MemoryRecord[] {
    const insert = this.database.prepare(
      `INSERT INTO memory_records
        (id, kind, text, source_type, source_turn_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const created: MemoryRecord[] = []
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        const id = randomUUID()
        const now = Date.now()
        insert.run(
          id,
          record.kind,
          record.text,
          record.source.type,
          record.source.turnId ?? null,
          now,
          now,
        )
        created.push(
          toRecord({
            id,
            kind: record.kind,
            text: record.text,
            source_type: record.source.type,
            source_turn_id: record.source.turnId ?? null,
            created_at: now,
            updated_at: now,
          }),
        )
      }
      this.database.exec('COMMIT')
      return Object.freeze(created)
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  update(
    id: string,
    changes: { kind?: MemoryKind; text?: string; source?: MemorySource },
  ): MemoryRecord | null {
    const current = this.getById(id)
    if (!current) return null
    this.database
      .prepare(
        `UPDATE memory_records
         SET kind = ?, text = ?, source_type = ?, source_turn_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        changes.kind ?? current.kind,
        changes.text ?? current.text,
        changes.source?.type ?? current.source.type,
        changes.source ? (changes.source.turnId ?? null) : (current.source.turnId ?? null),
        Date.now(),
        id,
      )
    return this.getById(id)
  }

  deleteMany(ids: readonly string[]): readonly string[] {
    const existing = ids.filter((id) => this.getById(id) !== null)
    if (existing.length === 0) return Object.freeze([])
    const remove = this.database.prepare('DELETE FROM memory_records WHERE id = ?')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const id of existing) remove.run(id)
      this.database.exec('COMMIT')
      return Object.freeze(existing)
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  list(kind: MemoryKind | undefined, limit: number): readonly MemoryRecord[] {
    const rows = (kind
      ? this.database
          .prepare(
            `SELECT id, kind, text, source_type, source_turn_id, created_at, updated_at
               FROM memory_records WHERE kind = ? ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(kind, limit)
      : this.database
          .prepare(
            `SELECT id, kind, text, source_type, source_turn_id, created_at, updated_at
               FROM memory_records ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(limit)) as unknown as MemoryRow[]
    return Object.freeze(rows.map(toRecord))
  }

  searchLexical(expression: string, limit: number): readonly MemoryRecord[] {
    const rows = this.database
      .prepare(
        `SELECT r.id, r.kind, r.text, r.source_type, r.source_turn_id, r.created_at, r.updated_at
         FROM memory_records_fts f
         JOIN memory_records r ON r.id = f.id
         WHERE memory_records_fts MATCH ?
         ORDER BY bm25(memory_records_fts), r.updated_at DESC
         LIMIT ?`,
      )
      .all(expression, limit) as unknown as MemoryRow[]
    return Object.freeze(rows.map(toRecord))
  }

  clear(): void {
    this.database.exec('DELETE FROM memory_records;')
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS memory_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO memory_settings (key, value) VALUES ('enabled', 'true');
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('fact', 'preference', 'decision', 'commitment', 'relationship')),
        text TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN ('conversation', 'manual')),
        source_turn_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_records_kind_updated
        ON memory_records(kind, updated_at DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_fts USING fts5(
        id UNINDEXED,
        text,
        tokenize = 'unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS memory_records_after_insert AFTER INSERT ON memory_records BEGIN
        INSERT INTO memory_records_fts(id, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_records_after_update AFTER UPDATE OF text ON memory_records BEGIN
        DELETE FROM memory_records_fts WHERE id = old.id;
        INSERT INTO memory_records_fts(id, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_records_after_delete AFTER DELETE ON memory_records BEGIN
        DELETE FROM memory_records_fts WHERE id = old.id;
      END;
      DELETE FROM memory_records_fts WHERE id NOT IN (SELECT id FROM memory_records);
      INSERT INTO memory_records_fts(id, text)
      SELECT r.id, r.text FROM memory_records r
      WHERE r.id NOT IN (SELECT id FROM memory_records_fts);
    `)
  }
}
