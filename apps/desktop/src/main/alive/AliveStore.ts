import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type {
  AliveAuditEntry,
  AutonomySettings,
  CreateGoalInput,
  CreateScheduledTaskInput,
  HabitSuggestion,
  PersistentGoal,
  ScheduledTask,
  UpdateGoalInput,
} from '../../shared/alive'

const DATABASE_VERSION = 1

export const DEFAULT_AUTONOMY_SETTINGS: AutonomySettings = Object.freeze({
  mode: 'suggest',
  globallySuspended: false,
  privacyMode: false,
  quietHours: Object.freeze({ enabled: true, startHour: 22, endHour: 8 }),
  cooldownMs: 15 * 60_000,
  maxDailyInitiatives: 6,
  fastBrain: Object.freeze({ enabled: false, timeoutMs: 1_200, maxTokens: 64 }),
})

interface GoalRow {
  id: string
  title: string
  description: string
  status: PersistentGoal['status']
  progress: number
  created_at: number
  updated_at: number
}

interface TaskRow {
  id: string
  title: string
  kind: ScheduledTask['kind']
  due_at: number
  interval_ms: number | null
  status: ScheduledTask['status']
  goal_id: string | null
  last_run_at: number | null
  next_run_at: number
  created_at: number
  updated_at: number
}

interface HabitRow {
  id: string
  habit_key: string
  title: string
  evidence_count: number
  status: HabitSuggestion['status']
  created_at: number
  updated_at: number
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

  goals(): readonly PersistentGoal[] {
    const rows = this.database
      .prepare(
        `SELECT id, title, description, status, progress, created_at, updated_at
         FROM alive_goals ORDER BY updated_at DESC`,
      )
      .all() as unknown as GoalRow[]
    return Object.freeze(rows.map(toGoal))
  }

  createGoal(input: CreateGoalInput): PersistentGoal {
    const now = Date.now()
    const goal: PersistentGoal = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? '',
      status: 'active',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        `INSERT INTO alive_goals
          (id, title, description, status, progress, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        goal.id,
        goal.title,
        goal.description,
        goal.status,
        goal.progress,
        goal.createdAt,
        goal.updatedAt,
      )
    return Object.freeze(goal)
  }

  updateGoal(input: UpdateGoalInput): PersistentGoal | null {
    const current = this.goals().find((goal) => goal.id === input.id)
    if (!current) return null
    const next: PersistentGoal = {
      ...current,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      status: input.status ?? current.status,
      progress: input.progress ?? current.progress,
      updatedAt: Date.now(),
    }
    this.database
      .prepare(
        `UPDATE alive_goals SET title = ?, description = ?, status = ?, progress = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(next.title, next.description, next.status, next.progress, next.updatedAt, next.id)
    return Object.freeze(next)
  }

  tasks(): readonly ScheduledTask[] {
    const rows = this.database
      .prepare(
        `SELECT id, title, kind, due_at, interval_ms, status, goal_id, last_run_at,
                next_run_at, created_at, updated_at
         FROM alive_tasks ORDER BY next_run_at ASC`,
      )
      .all() as unknown as TaskRow[]
    return Object.freeze(rows.map(toTask))
  }

  createTask(input: CreateScheduledTaskInput): ScheduledTask {
    const now = Date.now()
    const task: ScheduledTask = {
      id: randomUUID(),
      title: input.title,
      kind: input.kind,
      dueAt: input.dueAt,
      intervalMs: input.intervalMs,
      status: 'scheduled',
      goalId: input.goalId,
      nextRunAt: input.dueAt,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        `INSERT INTO alive_tasks
          (id, title, kind, due_at, interval_ms, status, goal_id, last_run_at,
           next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.title,
        task.kind,
        task.dueAt,
        task.intervalMs ?? null,
        task.status,
        task.goalId ?? null,
        task.nextRunAt,
        task.createdAt,
        task.updatedAt,
      )
    return Object.freeze(task)
  }

  setTaskStatus(id: string, status: ScheduledTask['status']): void {
    this.database
      .prepare('UPDATE alive_tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id)
  }

  deferTask(id: string, nextRunAt: number): void {
    this.database
      .prepare('UPDATE alive_tasks SET next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(nextRunAt, Date.now(), id)
  }

  claimTaskRun(task: ScheduledTask, runKey: string, now: number): boolean {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const inserted = this.database
        .prepare(
          'INSERT OR IGNORE INTO alive_task_runs (task_id, run_key, created_at) VALUES (?, ?, ?)',
        )
        .run(task.id, runKey, now)
      if (Number(inserted.changes) === 0) {
        this.database.exec('ROLLBACK')
        return false
      }
      const nextRunAt = task.intervalMs ? Math.max(now, task.nextRunAt) + task.intervalMs : now
      const status: ScheduledTask['status'] = task.intervalMs ? 'scheduled' : 'completed'
      this.database
        .prepare(
          `UPDATE alive_tasks
           SET last_run_at = ?, next_run_at = ?, status = ?, updated_at = ? WHERE id = ?`,
        )
        .run(now, nextRunAt, status, now, task.id)
      this.database.exec('COMMIT')
      return true
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  observeHabit(key: string, title: string): void {
    const now = Date.now()
    this.database
      .prepare(
        `INSERT INTO alive_habits
          (id, habit_key, title, evidence_count, status, created_at, updated_at)
         VALUES (?, ?, ?, 1, 'pending', ?, ?)
         ON CONFLICT(habit_key) DO UPDATE SET
           evidence_count = evidence_count + 1,
           title = excluded.title,
           updated_at = excluded.updated_at`,
      )
      .run(randomUUID(), key, title, now, now)
  }

  habits(): readonly HabitSuggestion[] {
    const rows = this.database
      .prepare(
        `SELECT id, habit_key, title, evidence_count, status, created_at, updated_at
         FROM alive_habits WHERE evidence_count >= 3 ORDER BY updated_at DESC`,
      )
      .all() as unknown as HabitRow[]
    return Object.freeze(rows.map(toHabit))
  }

  decideHabit(id: string, status: 'approved' | 'rejected'): void {
    this.database
      .prepare('UPDATE alive_habits SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id)
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
         WHERE category = 'autonomy' AND event = 'initiative' AND outcome = 'executed' AND at >= ?`,
      )
      .get(start.getTime()) as { count: number }
    return Number(row.count)
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
        CREATE TABLE alive_goals (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
          status TEXT NOT NULL, progress REAL NOT NULL, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE alive_tasks (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, due_at INTEGER NOT NULL,
          interval_ms INTEGER, status TEXT NOT NULL, goal_id TEXT, last_run_at INTEGER,
          next_run_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          FOREIGN KEY(goal_id) REFERENCES alive_goals(id) ON DELETE SET NULL
        );
        CREATE TABLE alive_task_runs (
          task_id TEXT NOT NULL, run_key TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(task_id, run_key),
          FOREIGN KEY(task_id) REFERENCES alive_tasks(id) ON DELETE CASCADE
        );
        CREATE TABLE alive_habits (
          id TEXT PRIMARY KEY, habit_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
          evidence_count INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE alive_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, category TEXT NOT NULL,
          event TEXT NOT NULL, entity_id TEXT, outcome TEXT NOT NULL, detail TEXT
        );
        CREATE INDEX alive_tasks_due_idx ON alive_tasks(status, next_run_at);
        CREATE INDEX alive_audit_at_idx ON alive_audit(at DESC);
        PRAGMA user_version = 1;
        COMMIT;
      `)
      this.saveSettings(DEFAULT_AUTONOMY_SETTINGS)
    }
  }
}

function toGoal(row: GoalRow): PersistentGoal {
  return Object.freeze({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    progress: row.progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function toTask(row: TaskRow): ScheduledTask {
  return Object.freeze({
    id: row.id,
    title: row.title,
    kind: row.kind,
    dueAt: row.due_at,
    intervalMs: row.interval_ms ?? undefined,
    status: row.status,
    goalId: row.goal_id ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function toHabit(row: HabitRow): HabitSuggestion {
  return Object.freeze({
    id: row.id,
    key: row.habit_key,
    title: row.title,
    evidenceCount: row.evidence_count,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}
