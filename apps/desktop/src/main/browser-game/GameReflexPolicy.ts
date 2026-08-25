import type {
  GameFrame,
  GameInputIntent,
  GameReflexBackendStatus,
  GameSessionScope,
  GameStrategy,
} from '../../shared/browser-game'
import type { GameReflexAdapter } from './GameReflexAdapter'
import { ObservingGameReflexAdapter } from './GameReflexAdapter'

export interface GameCalibrationContext {
  goal: string
  strategy: GameStrategy
  scope: GameSessionScope
}

export interface GameReflexState {
  strategy: GameStrategy
  elapsedMs: number
  inputEvents: number
}

/** A frame-local policy. Character Response Generation is never called from this contract. */
export interface GameReflexPolicy {
  status(): GameReflexBackendStatus
  initialize(context: GameCalibrationContext, signal: AbortSignal): Promise<void>
  decide(frame: GameFrame, state: GameReflexState, signal: AbortSignal): Promise<GameInputIntent>
  updateStrategy?(strategy: GameStrategy): void
  reset(): void
}

export class AdapterBackedGameReflexPolicy implements GameReflexPolicy {
  constructor(private readonly adapter: GameReflexAdapter) {}

  status(): GameReflexBackendStatus {
    return this.adapter.status()
  }

  initialize(context: GameCalibrationContext, signal: AbortSignal): Promise<void> {
    return this.adapter.initialize(context, signal)
  }

  decide(frame: GameFrame, state: GameReflexState, signal: AbortSignal): Promise<GameInputIntent> {
    return this.adapter.decide(frame, state, signal)
  }

  updateStrategy(strategy: GameStrategy): void {
    this.adapter.updateStrategy?.(strategy)
  }

  reset(): void {
    this.adapter.reset()
  }
}

/** Safe infrastructure backend used until a calibrated Adapter selects an input. */
export class ObservingGameReflexPolicy extends AdapterBackedGameReflexPolicy {
  constructor() {
    super(new ObservingGameReflexAdapter())
  }
}
