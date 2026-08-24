import type { EventBus } from '../../shared/runtime'
import { CharacterStateStore } from './CharacterStateStore'
import { PassiveEventBus } from './EventBus'

export { CharacterStateStore } from './CharacterStateStore'

export class ShioRuntime {
  readonly events: EventBus = new PassiveEventBus()
  readonly characterState = new CharacterStateStore(this.events)
}
