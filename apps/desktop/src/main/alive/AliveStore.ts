import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { AliveAuditEntry, AutonomySettings, MoodState } from '../../shared/alive'

const DATABASE_VERSION = 6

export const DEFAULT_AUTONOMY_SETTINGS: AutonomySettings = Object.freeze({
  mode: 'suggest',
  globallySuspended: false,
  privacyMode: false,
  quietHours: Object.freeze({ enabled: true, startHour: 22, endHour: 8 }),
  cooldownMs: 15 * 60_000,
  maxDailyInitiatives: 6,
  fastBrain: Object.freeze({ enabled: false, timeoutMs: 1_200, maxTokens: 64 }),
})

export const DEFAULT_MOOD_STATE: MoodState = Object.freeze({
  valence: 0,
  arousal: 0,
  confidence: 0.55,
  playfulness: 0.5,
  curiosity: 0.55,
  frustration: 0,
  updatedAt: 0,
})

export interface LegacyAliveHabitRecord {
  key: string
  summary: string
  evidenceCount: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
  updatedAt: number
}

export class AliveStore {
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

  version(): number {
    return DATABASE_VERSION
  }

  settings(): AutonomySettings {
    const row = this.database
      .prepare("SELECT value FROM alive_settings WHERE key = 'autonomy'")
      .get() as { value: string } | undefined
    if (!row) return DEFAULT_AUTONOMY_SETTINGS
    try {
      const parsed = JSON.parse(row.value) as Partial<AutonomySettings>
      return {
        ...DEFAULT_AUTONOMY_SETTINGS,
        ...parsed,
        quietHours: { ...DEFAULT_AUTONOMY_SETTINGS.quietHours, ...parsed.quietHours },
        fastBrain: { ...DEFAULT_AUTONOMY_SETTINGS.fastBrain, ...parsed.fastBrain },
      }
    } catch {
      return DEFAULT_AUTONOMY_SETTINGS
    }
  }

  saveSettings(settings: AutonomySettings): void {
    this.database
      .prepare(
        `INSERT INTO alive_settings (key, value) VALUES ('autonomy', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(JSON.stringify(settings))
  }

  mood(): MoodState {
    const row = this.database
      .prepare("SELECT value FROM alive_settings WHERE key = 'mood'")
      .get() as { value: string } | undefined
    if (!row) return DEFAULT_MOOD_STATE
    try {
      const parsed = JSON.parse(row.value) as Partial<MoodState>
      return {
        valence: boundedMoodValue(parsed.valence, DEFAULT_MOOD_STATE.valence),
        arousal: boundedMoodValue(parsed.arousal, DEFAULT_MOOD_STATE.arousal),
        confidence: boundedUnitValue(parsed.confidence, DEFAULT_MOOD_STATE.confidence),
        playfulness: boundedUnitValue(parsed.playfulness, DEFAULT_MOOD_STATE.playfulness),
        curiosity: boundedUnitValue(parsed.curiosity, DEFAULT_MOOD_STATE.curiosity),
        frustration: boundedUnitValue(parsed.frustration, DEFAULT_MOOD_STATE.frustration),
        updatedAt:
          typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
            ? Math.max(0, parsed.updatedAt)
            : 0,
      }
    } catch {
      return DEFAULT_MOOD_STATE
    }
  }

  saveMood(mood: MoodState): void {
    this.database
      .prepare(
        `INSERT INTO alive_settings (key, value) VALUES ('mood', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(JSON.stringify(mood))
  }

  legacyHabitRecords(): readonly LegacyAliveHabitRecord[] {
    const exists = this.database
      .prepare(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'alive_habits'",
      )
      .get() as { found: number } | undefined
    if (!exists) return Object.freeze([])
    return Object.freeze(
      this.database
        .prepare(
          `SELECT habit_key AS key, title AS summary, evidence_count AS evidenceCount,
                  status, created_at AS createdAt, updated_at AS updatedAt FROM alive_habits`,
        )
        .all() as unknown as LegacyAliveHabitRecord[],
    )
  }

  completeLegacyHabitMigration(): void {
    this.database.exec('DROP TABLE IF EXISTS alive_habits')
  }

  audit(
    category: AliveAuditEntry['category'],
    event: string,
    outcome: string,
    entityId?: string,
    detail?: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO alive_audit (at, category, event, entity_id, outcome, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(Date.now(), category, event, entityId ?? null, outcome, detail ?? null)
  }

  recentAudit(limit = 50): readonly AliveAuditEntry[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT id, at, category, event, entity_id AS entityId, outcome, detail
           FROM alive_audit ORDER BY id DESC LIMIT ?`,
        )
        .all(limit) as unknown as AliveAuditEntry[],
    )
  }

  dailyInitiativeCount(now: number): number {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM alive_audit
         WHERE category = 'autonomy' AND event = 'initiative'
           AND outcome IN ('executed', 'previewed') AND at >= ?`,
      )
      .get(start.getTime()) as { count: number }
    return Number(row.count)
  }

  lastInitiativeAt(): number | null {
    const row = this.database
      .prepare(
        `SELECT MAX(at) AS at FROM alive_audit
         WHERE category = 'autonomy' AND event = 'initiative'
           AND outcome IN ('executed', 'previewed')`,
      )
      .get() as { at: number | null }
    return row.at === null ? null : Number(row.at)
  }

  private migrate(): void {
    const version = Number(
      (this.database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    )
    if (version > DATABASE_VERSION) throw new Error('ALIVE_DATABASE_NEWER_THAN_RUNTIME')
    if (version === 0) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE alive_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE alive_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, category TEXT NOT NULL,
          event TEXT NOT NULL, entity_id TEXT, outcome TEXT NOT NULL, detail TEXT
        );
        CREATE INDEX alive_audit_at_idx ON alive_audit(at DESC);
        PRAGMA user_version = ${DATABASE_VERSION};
        COMMIT;
      `)
      this.saveSettings(DEFAULT_AUTONOMY_SETTINGS)
    } else if (version < DATABASE_VERSION) {
      // Older goal and reminder tables are left untouched and never reopened by Alive.
      this.database.exec(`PRAGMA user_version = ${DATABASE_VERSION}`)
    }
  }
}

function boundedMoodValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-1, Math.min(1, value))
    : fallback
}

function boundedUnitValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}
