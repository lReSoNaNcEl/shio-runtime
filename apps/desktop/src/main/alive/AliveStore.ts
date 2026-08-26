import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type {
  AliveAuditEntry,
  AutonomyScope,
  AutonomySettings,
  CreateGoalInput,
  CreateScheduledTaskInput,
  GoalEventWatch,
  GoalExecutionState,
  GoalWakeCondition,
  MoodState,
  PersistentGoal,
  ScheduledTask,
  UpdateGoalInput,
} from '../../shared/alive'

type GoalStoreUpdateInput = UpdateGoalInput & { progress?: number }

const DATABASE_VERSION = 5

const DEFAULT_GOAL_BUDGET = Object.freeze({
  maxSteps: 12,
  maxToolCalls: 24,
  maxElapsedMs: 4 * 60 * 60_000,
  maxFailures: 3,
})

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

interface GoalRow {
  id: string
  title: string
  description: string
  next_step: string
  last_note: string
  owner: PersistentGoal['owner']
  status: PersistentGoal['status']
  progress: number
  measurable: number
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

export interface LegacyAliveHabitRecord {
  key: string
  summary: string
  evidenceCount: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
  updatedAt: number
}

interface GoalExecutionRow {
  goal_id: string
  phase: GoalExecutionState['phase']
  current_step: string | null
  planned_steps: string
  completed_steps: string
  current_step_outcome: string | null
  attempts: number
  tool_calls: number
  failures: number
  started_at: number | null
  last_progress_at: number | null
  action_budget: string
  updated_at: number
}

interface GoalWatchRow {
  id: string
  goal_id: string
  condition: string
  status: GoalEventWatch['status']
  created_at: number
  satisfied_at: number | null
}

interface AutonomyScopeRow {
  id: string
  goal_id: string | null
  scope: string
  actions_used: number
  approved_at: number
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

  goals(): readonly PersistentGoal[] {
    const rows = this.database
      .prepare(
        `SELECT id, title, description, next_step, last_note, owner, status, progress,
                measurable, created_at, updated_at
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
      nextStep: input.nextStep ?? '',
      lastNote: '',
      owner: input.owner ?? 'shared',
      status: 'active',
      progress: 0,
      measurable: input.measurable ?? false,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        `INSERT INTO alive_goals
          (id, title, description, next_step, last_note, owner, status, progress,
           measurable, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        goal.id,
        goal.title,
        goal.description,
        goal.nextStep,
        goal.lastNote,
        goal.owner,
        goal.status,
        goal.progress,
        goal.measurable ? 1 : 0,
        goal.createdAt,
        goal.updatedAt,
      )
    this.saveGoalExecution({
      goalId: goal.id,
      phase: 'idle',
      plannedSteps: [],
      completedSteps: [],
      attempts: 0,
      toolCalls: 0,
      failures: 0,
      actionBudget: DEFAULT_GOAL_BUDGET,
      updatedAt: now,
    })
    return Object.freeze(goal)
  }

  goalExecutions(): readonly GoalExecutionState[] {
    const rows = this.database
      .prepare(
        `SELECT goal_id, phase, current_step, planned_steps, completed_steps,
                current_step_outcome, attempts, tool_calls, failures, started_at,
                last_progress_at, action_budget, updated_at
         FROM alive_goal_executions ORDER BY updated_at DESC`,
      )
      .all() as unknown as GoalExecutionRow[]
    return Object.freeze(rows.map(toGoalExecution))
  }

  saveGoalExecution(state: GoalExecutionState): void {
    this.database
      .prepare(
        `INSERT INTO alive_goal_executions
          (goal_id, phase, current_step, planned_steps, completed_steps, current_step_outcome,
           attempts, tool_calls, failures, started_at, last_progress_at, action_budget, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(goal_id) DO UPDATE SET
           phase = excluded.phase, current_step = excluded.current_step,
           planned_steps = excluded.planned_steps, completed_steps = excluded.completed_steps,
           current_step_outcome = excluded.current_step_outcome,
           attempts = excluded.attempts, tool_calls = excluded.tool_calls,
           failures = excluded.failures, started_at = excluded.started_at,
           last_progress_at = excluded.last_progress_at,
           action_budget = excluded.action_budget, updated_at = excluded.updated_at`,
      )
      .run(
        state.goalId,
        state.phase,
        state.currentStep ?? null,
        JSON.stringify(state.plannedSteps),
        JSON.stringify(state.completedSteps),
        state.currentStepOutcome ? JSON.stringify(state.currentStepOutcome) : null,
        state.attempts,
        state.toolCalls,
        state.failures,
        state.startedAt ?? null,
        state.lastProgressAt ?? null,
        JSON.stringify(state.actionBudget),
        state.updatedAt,
      )
  }

  goalWatches(status?: GoalEventWatch['status']): readonly GoalEventWatch[] {
    const rows = (status
      ? this.database
          .prepare(
            `SELECT id, goal_id, condition, status, created_at, satisfied_at
             FROM alive_goal_watches WHERE status = ? ORDER BY created_at`,
          )
          .all(status)
      : this.database
          .prepare(
            `SELECT id, goal_id, condition, status, created_at, satisfied_at
             FROM alive_goal_watches ORDER BY created_at`,
          )
          .all()) as unknown as GoalWatchRow[]
    return Object.freeze(rows.map(toGoalWatch))
  }

  createGoalWatch(goalId: string, condition: GoalWakeCondition, now: number): GoalEventWatch {
    const watch: GoalEventWatch = {
      id: randomUUID(),
      goalId,
      condition,
      status: 'active',
      createdAt: now,
    }
    this.database
      .prepare(
        `INSERT INTO alive_goal_watches
          (id, goal_id, condition, status, created_at, satisfied_at)
         VALUES (?, ?, ?, 'active', ?, NULL)`,
      )
      .run(watch.id, goalId, JSON.stringify(condition), now)
    return Object.freeze(watch)
  }

  satisfyGoalWatch(id: string, now: number): void {
    this.database
      .prepare(
        `UPDATE alive_goal_watches SET status = 'satisfied', satisfied_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(now, id)
  }

  autonomyScope(goalId: string): AutonomyScope | null {
    const row = this.database
      .prepare(
        `SELECT id, goal_id, scope, actions_used, approved_at
         FROM alive_autonomy_scopes WHERE goal_id = ?`,
      )
      .get(goalId) as AutonomyScopeRow | undefined
    return row ? toAutonomyScope(row) : null
  }

  saveAutonomyScope(scope: AutonomyScope): void {
    this.database
      .prepare(
        `INSERT INTO alive_autonomy_scopes (id, goal_id, scope, actions_used, approved_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(goal_id) DO UPDATE SET
           id = excluded.id, scope = excluded.scope, actions_used = excluded.actions_used,
           approved_at = excluded.approved_at`,
      )
      .run(
        scope.id,
        scope.goalId ?? null,
        JSON.stringify(scope),
        scope.actionsUsed,
        scope.approvedAt,
      )
  }

  updateGoal(input: GoalStoreUpdateInput): PersistentGoal | null {
    const current = this.goals().find((goal) => goal.id === input.id)
    if (!current) return null
    const next: PersistentGoal = {
      ...current,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      nextStep: input.nextStep ?? current.nextStep,
      lastNote: input.lastNote ?? current.lastNote,
      owner: input.owner ?? current.owner,
      status: input.status ?? current.status,
      progress: input.progress ?? current.progress,
      measurable: input.measurable ?? current.measurable,
      updatedAt: Date.now(),
    }
    this.database
      .prepare(
        `UPDATE alive_goals
         SET title = ?, description = ?, next_step = ?, last_note = ?, owner = ?, status = ?,
             progress = ?, measurable = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
        next.nextStep,
        next.lastNote,
        next.owner,
        next.status,
        next.progress,
        next.measurable ? 1 : 0,
        next.updatedAt,
        next.id,
      )
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
        CREATE TABLE alive_goals (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
          next_step TEXT NOT NULL, last_note TEXT NOT NULL, owner TEXT NOT NULL,
          status TEXT NOT NULL, progress REAL NOT NULL, measurable INTEGER NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
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
        CREATE TABLE alive_goal_executions (
          goal_id TEXT PRIMARY KEY, phase TEXT NOT NULL, current_step TEXT,
          planned_steps TEXT NOT NULL, completed_steps TEXT NOT NULL,
          current_step_outcome TEXT, attempts INTEGER NOT NULL, tool_calls INTEGER NOT NULL,
          failures INTEGER NOT NULL, started_at INTEGER,
          last_progress_at INTEGER, action_budget TEXT NOT NULL, updated_at INTEGER NOT NULL,
          FOREIGN KEY(goal_id) REFERENCES alive_goals(id) ON DELETE CASCADE
        );
        CREATE TABLE alive_goal_watches (
          id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, condition TEXT NOT NULL,
          status TEXT NOT NULL, created_at INTEGER NOT NULL, satisfied_at INTEGER,
          FOREIGN KEY(goal_id) REFERENCES alive_goals(id) ON DELETE CASCADE
        );
        CREATE TABLE alive_autonomy_scopes (
          id TEXT PRIMARY KEY, goal_id TEXT UNIQUE, scope TEXT NOT NULL,
          actions_used INTEGER NOT NULL, approved_at INTEGER NOT NULL,
          FOREIGN KEY(goal_id) REFERENCES alive_goals(id) ON DELETE CASCADE
        );
        CREATE TABLE alive_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, category TEXT NOT NULL,
          event TEXT NOT NULL, entity_id TEXT, outcome TEXT NOT NULL, detail TEXT
        );
        CREATE INDEX alive_tasks_due_idx ON alive_tasks(status, next_run_at);
        CREATE INDEX alive_audit_at_idx ON alive_audit(at DESC);
        CREATE INDEX alive_goal_watches_status_idx ON alive_goal_watches(status, created_at);
        PRAGMA user_version = 5;
        COMMIT;
      `)
      this.saveSettings(DEFAULT_AUTONOMY_SETTINGS)
      return
    }
    if (version === 1) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE alive_goals ADD COLUMN next_step TEXT NOT NULL DEFAULT '';
        ALTER TABLE alive_goals ADD COLUMN last_note TEXT NOT NULL DEFAULT '';
        ALTER TABLE alive_goals ADD COLUMN owner TEXT NOT NULL DEFAULT 'shared';
        ALTER TABLE alive_goals ADD COLUMN measurable INTEGER NOT NULL DEFAULT 0;
        UPDATE alive_goals SET measurable = 1 WHERE progress > 0 AND progress < 1;
        PRAGMA user_version = 2;
        COMMIT;
      `)
    }
    if (version <= 2) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE alive_goal_executions (
          goal_id TEXT PRIMARY KEY, phase TEXT NOT NULL, current_step TEXT,
          planned_steps TEXT NOT NULL, completed_steps TEXT NOT NULL, attempts INTEGER NOT NULL,
          tool_calls INTEGER NOT NULL, failures INTEGER NOT NULL, started_at INTEGER,
          last_progress_at INTEGER, action_budget TEXT NOT NULL, updated_at INTEGER NOT NULL,
          FOREIGN KEY(goal_id) REFERENCES alive_goals(id) ON DELETE CASCADE
        );
        CREATE TABLE alive_goal_watches (
          id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, condition TEXT NOT NULL,
          status TEXT NOT NULL, created_at INTEGER NOT NULL, satisfied_at INTEGER,
          FOREIGN KEY(goal_id) REFERENCES alive_goals(id) ON DELETE CASCADE
        );
        CREATE TABLE alive_autonomy_scopes (
          id TEXT PRIMARY KEY, goal_id TEXT UNIQUE, scope TEXT NOT NULL,
          actions_used INTEGER NOT NULL, approved_at INTEGER NOT NULL,
          FOREIGN KEY(goal_id) REFERENCES alive_goals(id) ON DELETE CASCADE
        );
        CREATE INDEX alive_goal_watches_status_idx ON alive_goal_watches(status, created_at);
        INSERT INTO alive_goal_executions
          (goal_id, phase, current_step, planned_steps, completed_steps, attempts, tool_calls,
           failures, started_at, last_progress_at, action_budget, updated_at)
        SELECT id, 'idle', NULL, '[]', '[]', 0, 0, 0, NULL, NULL,
          '{"maxSteps":12,"maxToolCalls":24,"maxElapsedMs":14400000,"maxFailures":3}',
          updated_at
        FROM alive_goals;
        PRAGMA user_version = 3;
        COMMIT;
      `)
    }
    if (version <= 3) this.database.exec('PRAGMA user_version = 4;')
    if (version <= 4) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE alive_goal_executions ADD COLUMN current_step_outcome TEXT;
        PRAGMA user_version = 5;
        COMMIT;
      `)
    }
  }
}

function toGoal(row: GoalRow): PersistentGoal {
  return Object.freeze({
    id: row.id,
    title: row.title,
    description: row.description,
    nextStep: row.next_step,
    lastNote: row.last_note,
    owner: row.owner,
    status: row.status,
    progress: row.progress,
    measurable: row.measurable === 1,
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

function toGoalExecution(row: GoalExecutionRow): GoalExecutionState {
  return Object.freeze({
    goalId: row.goal_id,
    phase: row.phase,
    currentStep: row.current_step ?? undefined,
    plannedSteps: Object.freeze(JSON.parse(row.planned_steps) as string[]),
    completedSteps: Object.freeze(JSON.parse(row.completed_steps) as string[]),
    currentStepOutcome: row.current_step_outcome
      ? freezeGoalStepOutcome(
          JSON.parse(row.current_step_outcome) as NonNullable<
            GoalExecutionState['currentStepOutcome']
          >,
        )
      : undefined,
    attempts: row.attempts,
    toolCalls: row.tool_calls,
    failures: row.failures,
    startedAt: row.started_at ?? undefined,
    lastProgressAt: row.last_progress_at ?? undefined,
    actionBudget: Object.freeze(
      JSON.parse(row.action_budget) as GoalExecutionState['actionBudget'],
    ),
    updatedAt: row.updated_at,
  })
}

function freezeGoalStepOutcome(
  outcome: NonNullable<GoalExecutionState['currentStepOutcome']>,
): NonNullable<GoalExecutionState['currentStepOutcome']> {
  return Object.freeze({
    verifiedActionIds: Object.freeze([...outcome.verifiedActionIds]),
    expectationSatisfied: outcome.expectationSatisfied,
    stepCompleted: outcome.stepCompleted,
  })
}

function toGoalWatch(row: GoalWatchRow): GoalEventWatch {
  return Object.freeze({
    id: row.id,
    goalId: row.goal_id,
    condition: Object.freeze(JSON.parse(row.condition) as GoalWakeCondition),
    status: row.status,
    createdAt: row.created_at,
    satisfiedAt: row.satisfied_at ?? undefined,
  })
}

function toAutonomyScope(row: AutonomyScopeRow): AutonomyScope {
  const parsed = JSON.parse(row.scope) as AutonomyScope
  return Object.freeze({
    ...parsed,
    id: row.id,
    goalId: row.goal_id ?? undefined,
    actionsUsed: row.actions_used,
    approvedAt: row.approved_at,
  })
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
