import type {
  AttentionCandidate,
  AutonomySettings,
  BehaviorCommand,
  CreateScheduledTaskInput,
  ScheduledTask,
} from '../../shared/alive'
import { mainLog } from '../logging/safeLogger'
import type { AliveStore } from './AliveStore'
import { BehaviorRuntime } from './BehaviorRuntime'
import type {
  ProactiveInitiativeApproval,
  ProactiveInitiativeGate,
} from './ProactiveInitiativeGate'
import { SchedulerRuntime } from './SchedulerRuntime'

interface ScheduledTaskRuntimeOptions {
  store: AliveStore
  initiativeGate: ProactiveInitiativeGate
  markSchedulerObserved(now: number): void
  onBehavior(
    command: BehaviorCommand,
    authority: ProactiveInitiativeApproval | 'explicit-user',
  ): boolean
  onChanged(): void
  onTick?(now: number): void
}

/** Owns typed scheduled-task occurrence semantics on top of the single-flight clock. */
export class ScheduledTaskRuntime {
  private readonly clock = new SchedulerRuntime()
  private readonly behavior = new BehaviorRuntime()
  private lastErrorCode: string | undefined
  private disposed = false

  constructor(private readonly options: ScheduledTaskRuntimeOptions) {}

  start(): void {
    if (this.disposed || this.clock.isRunning()) return
    this.clock.start((now) => this.tick(now))
  }

  dispose(): void {
    this.disposed = true
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
    this.executeConfirmed(task, Date.now())
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
    this.options.markSchedulerObserved(now)
    try {
      this.options.onTick?.(now)
      for (const task of this.options.store.tasks()) {
        if (task.status !== 'scheduled' || task.nextRunAt > now) continue
        const decision = await this.options.initiativeGate.submit(
          {
            origin: 'scheduler',
            entityId: task.id,
            candidates: [scheduledAttentionCandidate(task, now)],
          },
          (approval) => {
            if (approval.outcome === 'preview') {
              this.options.store.setTaskStatus(task.id, 'waiting_confirmation')
              return this.options.onBehavior(
                this.behavior.scheduledInitiative(task.id, task.title, now),
                approval,
              )
            }
            return this.executeAdmitted(task, now, approval)
          },
        )
        if (this.disposed) return
        if (decision.outcome === 'defer') {
          this.options.store.deferTask(task.id, decision.retryAt)
        } else if (decision.outcome === 'ignore' || decision.outcome === 'observe') {
          this.options.store.deferTask(task.id, now + 60_000)
        }
      }
      this.lastErrorCode = undefined
    } catch (error) {
      this.lastErrorCode = error instanceof Error ? error.name : 'SCHEDULER_FAILURE'
      mainLog.error('[SchedulerRuntime] tick failed', { code: this.lastErrorCode })
    } finally {
      if (!this.disposed) this.options.onChanged()
    }
  }

  private executeAdmitted(
    task: ScheduledTask,
    now: number,
    authority: ProactiveInitiativeApproval | 'explicit-user',
  ): boolean {
    const runKey = `${task.id}:${task.nextRunAt}`
    if (!this.options.store.claimTaskRun(task, runKey, now)) return false
    return this.options.onBehavior(
      this.behavior.scheduledInitiative(task.id, task.title, now),
      authority,
    )
  }

  private executeConfirmed(task: ScheduledTask, now: number): void {
    if (!this.executeAdmitted(task, now, 'explicit-user')) return
    this.options.store.audit(
      'autonomy',
      'initiative',
      'confirmed',
      task.id,
      'explicit-confirmation',
    )
  }
}

function scheduledAttentionCandidate(task: ScheduledTask, now: number): AttentionCandidate {
  return Object.freeze({
    id: `scheduler:${task.id}:${task.nextRunAt}`,
    source: 'scheduler',
    summary: task.title.slice(0, 300),
    salience: task.kind === 'reminder' ? 0.78 : 0.7,
    novelty: 0.3,
    urgency: task.kind === 'reminder' ? 0.68 : 0.55,
    socialRelevance: 0.72,
    interruptibility: 'when-idle',
    createdAt: now,
    expiresAt: now + 15 * 60_000,
  })
}
