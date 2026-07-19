import type { CharacterState } from '../../shared/runtime/character-state'
import {
  cloneCharacterState,
  INITIAL_CHARACTER_STATE,
  normalizeCharacterState,
} from '../../shared/runtime/character-state'
import type { EventBus } from '../../shared/runtime/events'
import { PassiveEventBus } from './EventBus'

export type RuntimeRegistryEntry = object

export class CharacterStateStore {
  private state: CharacterState = cloneCharacterState(INITIAL_CHARACTER_STATE)

  get(): CharacterState {
    return cloneCharacterState(this.state)
  }

  update(updater: (current: CharacterState) => CharacterState): CharacterState {
    this.state = normalizeCharacterState(updater(cloneCharacterState(this.state)))
    return cloneCharacterState(this.state)
  }
}

export class RuntimeRegistry {
  private runtimes = new Map<string, RuntimeRegistryEntry>()

  register(name: string, runtime: RuntimeRegistryEntry): void {
    this.runtimes.set(name, runtime)
  }

  list(): readonly string[] {
    return [...this.runtimes.keys()]
  }
}

export class ShioRuntime {
  readonly characterState = new CharacterStateStore()
  readonly events: EventBus = new PassiveEventBus()
  readonly registry = new RuntimeRegistry()
}
