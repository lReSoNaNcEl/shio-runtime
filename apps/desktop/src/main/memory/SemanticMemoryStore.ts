import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type {
  CompletedMemoryFact,
  HabitRecord,
  HabitType,
  MemoryKind,
  MemoryRecord,
  MemorySource,
} from '../../shared/memory'

interface MemoryRow {
  id: string
  kind: MemoryKind
  text: string
  source_type: MemorySource['type']
  source_turn_id: string | null
  created_at: number
  updated_at: number
}

interface HabitRow {
  id: string
  habit_key: string
  type: HabitType
  summary: string
  evidence_count: number
  confidence: number
  first_observed_at: number
  last_observed_at: number
  last_used_at: number | null
  status: HabitRecord['status']
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
  observeCompletedFact?(fact: CompletedMemoryFact): HabitRecord | null
  habits?(minimumEvidence?: number): readonly HabitRecord[]
  decideHabit?(id: string, status: 'approved' | 'rejected'): HabitRecord | null
  markHabitUsed?(id: string, at: number): void
  importLegacyHabits?(
    records: readonly {
      key: string
      summary: string
      evidenceCount: number
      status: 'pending' | 'approved' | 'rejected'
      createdAt: number
      updatedAt: number
    }[],
  ): void
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

  observeCompletedFact(fact: CompletedMemoryFact): HabitRecord | null {
    const descriptor = habitDescriptor(fact)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const inserted = this.database
        .prepare('INSERT OR IGNORE INTO memory_habit_events (event_id, observed_at) VALUES (?, ?)')
        .run(fact.eventId, fact.at)
      if (Number(inserted.changes) === 0) {
        this.database.exec('ROLLBACK')
        return this.habitByKey(descriptor.key)
      }
      this.database
        .prepare(
          `INSERT INTO memory_habits
            (id, habit_key, type, summary, evidence_count, confidence, first_observed_at,
             last_observed_at, last_used_at, status)
           VALUES (?, ?, ?, ?, 1, 0.2, ?, ?, NULL, 'candidate')
           ON CONFLICT(habit_key) DO UPDATE SET
             summary = excluded.summary,
             evidence_count = memory_habits.evidence_count + 1,
             confidence = MIN(1.0, (memory_habits.evidence_count + 1) / 5.0),
             last_observed_at = excluded.last_observed_at`,
        )
        .run(randomUUID(), descriptor.key, descriptor.type, descriptor.summary, fact.at, fact.at)
      this.database.exec('COMMIT')
      return this.habitByKey(descriptor.key)
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  habits(minimumEvidence = 1): readonly HabitRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, habit_key, type, summary, evidence_count, confidence, first_observed_at,
                last_observed_at, last_used_at, status
         FROM memory_habits WHERE evidence_count >= ? ORDER BY last_observed_at DESC`,
      )
      .all(minimumEvidence) as unknown as HabitRow[]
    return Object.freeze(rows.map(toHabit))
  }

  decideHabit(id: string, status: 'approved' | 'rejected'): HabitRecord | null {
    this.database.prepare('UPDATE memory_habits SET status = ? WHERE id = ?').run(status, id)
    return this.habits().find((habit) => habit.id === id) ?? null
  }

  markHabitUsed(id: string, at: number): void {
    this.database.prepare('UPDATE memory_habits SET last_used_at = ? WHERE id = ?').run(at, id)
  }

  importLegacyHabits(
    records: readonly {
      key: string
      summary: string
      evidenceCount: number
      status: 'pending' | 'approved' | 'rejected'
      createdAt: number
      updatedAt: number
    }[],
  ): void {
    const insert = this.database.prepare(
      `INSERT INTO memory_habits
        (id, habit_key, type, summary, evidence_count, confidence, first_observed_at,
         last_observed_at, last_used_at, status)
       VALUES (?, ?, 'routine', ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(habit_key) DO UPDATE SET
         evidence_count = MAX(memory_habits.evidence_count, excluded.evidence_count),
         confidence = MAX(memory_habits.confidence, excluded.confidence),
         last_observed_at = MAX(memory_habits.last_observed_at, excluded.last_observed_at)`,
    )
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        insert.run(
          randomUUID(),
          record.key,
          record.summary.slice(0, 300),
          Math.max(1, record.evidenceCount),
          Math.min(1, record.evidenceCount / 5),
          record.createdAt,
          record.updatedAt,
          record.status === 'pending' ? 'candidate' : record.status,
        )
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private habitByKey(key: string): HabitRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, habit_key, type, summary, evidence_count, confidence, first_observed_at,
                last_observed_at, last_used_at, status FROM memory_habits WHERE habit_key = ?`,
      )
      .get(key) as HabitRow | undefined
    return row ? toHabit(row) : null
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
      CREATE TABLE IF NOT EXISTS memory_habits (
        id TEXT PRIMARY KEY, habit_key TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
        summary TEXT NOT NULL, evidence_count INTEGER NOT NULL, confidence REAL NOT NULL,
        first_observed_at INTEGER NOT NULL, last_observed_at INTEGER NOT NULL,
        last_used_at INTEGER, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_habit_events (
        event_id TEXT PRIMARY KEY, observed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_habits_status_observed
        ON memory_habits(status, last_observed_at DESC);
      DELETE FROM memory_records_fts WHERE id NOT IN (SELECT id FROM memory_records);
      INSERT INTO memory_records_fts(id, text)
      SELECT r.id, r.text FROM memory_records r
      WHERE r.id NOT IN (SELECT id FROM memory_records_fts);
    `)
  }
}

function habitDescriptor(fact: CompletedMemoryFact): {
  key: string
  type: HabitType
  summary: string
} {
  switch (fact.kind) {
    case 'task-completed':
      return {
        key: 'task-follow-through',
        type: 'routine',
        summary: 'Доводить начатые задачи до проверенного завершения',
      }
    case 'goal-completed':
      return {
        key: 'goal-follow-through',
        type: 'routine',
        summary: 'Доводить выбранные цели до завершения',
      }
    case 'action-verified':
      return {
        key: 'verified-action-follow-through',
        type: 'interaction-style',
        summary: 'Проверять результат внешнего действия до сообщения об успехе',
      }
  }
}

function toHabit(row: HabitRow): HabitRecord {
  return Object.freeze({
    id: row.id,
    key: row.habit_key,
    type: row.type,
    summary: row.summary,
    evidenceCount: row.evidence_count,
    confidence: Math.max(0, Math.min(1, row.confidence)),
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    lastUsedAt: row.last_used_at ?? undefined,
    status: row.status,
  })
}
