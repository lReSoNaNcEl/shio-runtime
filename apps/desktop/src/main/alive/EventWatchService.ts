import type { GoalEventWatch, GoalWakeEvent } from '../../shared/alive'
import type { AliveStore } from './AliveStore'
import type { GoalRuntime } from './GoalRuntime'

/** Matches only fixed typed conditions; arbitrary renderer/model predicates never cross this boundary. */
export class EventWatchService {
  constructor(
    private readonly store: AliveStore,
    private readonly goals: GoalRuntime,
  ) {}

  snapshot(): readonly GoalEventWatch[] {
    return this.store.goalWatches()
  }

  observe(event: GoalWakeEvent): readonly GoalEventWatch[] {
    const matched = this.store.goalWatches('active').filter((watch) => matches(watch, event))
    for (const watch of matched) {
      this.store.satisfyGoalWatch(watch.id, event.at)
      this.goals.wake(watch.goalId, event.at)
    }
    return Object.freeze(matched)
  }

  tick(now = Date.now()): readonly GoalEventWatch[] {
    return this.observe({ kind: 'time', at: now })
  }
}

function matches(watch: GoalEventWatch, event: GoalWakeEvent): boolean {
  const condition = watch.condition
  if (condition.kind !== event.kind) return false
  switch (condition.kind) {
    case 'time':
      return event.kind === 'time' && event.at >= condition.at
    case 'action-terminal':
      return event.kind === 'action-terminal' && event.actionId === condition.actionId
    case 'process-exit':
      return event.kind === 'process-exit' && event.processId === condition.processId
    case 'world-event':
      return event.kind === 'world-event' && event.eventType === condition.eventType
    case 'browser-url':
      return (
        event.kind === 'browser-url' &&
        event.sessionId === condition.sessionId &&
        urlMatches(event.url, condition.predicate.operator, condition.predicate.value)
      )
  }
}

function urlMatches(url: string, operator: 'equals' | 'prefix' | 'origin', value: string): boolean {
  try {
    if (operator === 'equals') return new URL(url).href === new URL(value).href
    if (operator === 'origin') return new URL(url).origin === new URL(value).origin
    return new URL(url).href.startsWith(new URL(value).href)
  } catch {
    return false
  }
}
