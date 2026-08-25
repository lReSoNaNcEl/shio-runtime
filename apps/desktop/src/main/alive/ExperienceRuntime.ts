import type {
  AutonomySettings,
  BehaviorCommand,
  ExperienceEvent,
  WorldContextSnapshot,
} from '../../shared/alive'
import type { AliveStore } from './AliveStore'
import type { BehaviorRuntime } from './BehaviorRuntime'

export class ExperienceRuntime {
  constructor(
    private readonly store: AliveStore,
    private readonly behavior: BehaviorRuntime,
  ) {}

  observe(
    event: ExperienceEvent,
    settings: AutonomySettings,
    world: WorldContextSnapshot,
  ): BehaviorCommand | null {
    this.store.audit('experience', event.type, 'observed')
    if (event.type === 'task-completed') {
      this.store.observeHabit('task-follow-through', 'Регулярно завершать запланированные задачи')
      this.store.audit('habit', 'evidence_observed', 'success', event.taskId)
    }
    const command = this.behavior.observe(event, settings, world)
    if (command) this.store.audit('behavior', 'silence_reaction', 'executed')
    return command
  }
}
