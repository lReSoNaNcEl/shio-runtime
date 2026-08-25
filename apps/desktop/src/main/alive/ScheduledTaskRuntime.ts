import { randomUUID } from 'node:crypto'

import type {
  AutonomySettings,
  BehaviorCommand,
  CreateScheduledTaskInput,
  ScheduledTask,
} from '../../shared/alive'
import { mainLog } from '../logging/safeLogger'
import type { AliveStore } from './AliveStore'
import type { AutonomyEnvelope } from './AutonomyEnvelope'
import { SchedulerRuntime } from './SchedulerRuntime'
import type { WorldContextRuntime } from './WorldContextRuntime'

interface ScheduledTaskRuntimeOptions {
  store: AliveStore
  envelope: AutonomyEnvelope
  world: WorldContextRuntime
  onBehavior(command: BehaviorCommand): void
  onChanged(): void
}

/** Owns typed scheduled-task occurrence semantics on top of the single-flight clock. */
export class ScheduledTaskRuntime {
  private readonly clock = new SchedulerRuntime()
  private lastInitiativeAt: number | null = null
  private lastErrorCode: string | undefined

  constructor(private readonly options: ScheduledTaskRuntimeOptions) {}

  start(): void {
    if (this.clock.isRunning()) return
    this.lastInitiativeAt =
      this.options.store
        .recentAudit()
        .find(
          (entry) =>
            entry.category === 'autonomy' &&
            entry.event === 'initiative' &&
            entry.outcome === 'executed',
        )?.at ?? null
    this.clock.start((now) => this.tick(now))
  }

  dispose(): void {
    this.clock.dispose()
  }

  snapshot(): readonly ScheduledTask[] {
    return this.options.store.tasks()
  }

  create(input: CreateScheduledTaskInput): ScheduledTask {
    const task = this.options.store.createTask(input)
    this.options.store.audit('scheduler', 'task_created', 'success', task.id)
    return task
  }

  setStatus(id: string, status: ScheduledTask['status']): void {
    this.options.store.setTaskStatus(id, status)
    this.options.store.audit('scheduler', 'task_status_updated', 'success', id, status)
  }

  approve(id: string, settings: AutonomySettings): void {
    if (settings.globallySuspended) throw new Error('AUTONOMY_SUSPENDED')
    const task = this.options.store.tasks().find((candidate) => candidate.id === id)
    if (task?.status !== 'waiting_confirmation') throw new Error('TASK_NOT_CONFIRMABLE')
    this.execute(task, Date.now(), 'explicit-confirmation')
  }

  isRunning(): boolean {
    return this.clock.isRunning()
  }

  lastTickAt(): number | null {
    return this.clock.lastTickAt()
  }

  errorCode(): string | undefined {
    return this.lastErrorCode
  }

  private async tick(now: number): Promise<void> {
    this.options.world.markSchedulerObserved(now)
    try {
      for (const task of this.options.store.tasks()) {
        if (task.status !== 'scheduled' || task.nextRunAt > now) continue
        const settings = this.options.store.settings()
        const decision = this.options.envelope.decide({
          task,
          settings,
          world: this.options.world.snapshot(settings, now),
          now,
          dailyInitiatives: this.options.store.dailyInitiativeCount(now),
          lastInitiativeAt: this.lastInitiativeAt,
        })
        if (decision.outcome === 'defer') {
          this.options.store.deferTask(task.id, decision.retryAt)
          this.options.store.audit('autonomy', 'initiative', 'deferred', task.id, decision.reason)
        } else if (decision.outcome === 'preview') {
          this.options.store.setTaskStatus(task.id, 'waiting_confirmation')
          this.options.store.audit('autonomy', 'initiative', 'previewed', task.id, decision.reason)
          this.options.onBehavior({
            type: 'initiative',
            id: randomUUID(),
            at: now,
            taskId: task.id,
            title: task.title,
          })
        } else {
          this.execute(task, now, 'full-control')
        }
      }
      this.lastErrorCode = undefined
    } catch (error) {
      this.lastErrorCode = error instanceof Error ? error.name : 'SCHEDULER_FAILURE'
      mainLog.error('[SchedulerRuntime] tick failed', { code: this.lastErrorCode })
    } finally {
      this.options.onChanged()
    }
  }

  private execute(task: ScheduledTask, now: number, authority: string): void {
    const runKey = `${task.id}:${task.nextRunAt}`
    if (!this.options.store.claimTaskRun(task, runKey, now)) return
    this.lastInitiativeAt = now
    this.options.store.audit('autonomy', 'initiative', 'executed', task.id, authority)
    this.options.onBehavior({
      type: 'initiative',
      id: randomUUID(),
      at: now,
      taskId: task.id,
      title: task.title,
    })
  }
}
