import type {
  GameFrame,
  GameInputIntent,
  GameSessionScope,
  GameStrategy,
} from '../../shared/browser-game'

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
  initialize(context: GameCalibrationContext, signal: AbortSignal): Promise<void>
  decide(frame: GameFrame, state: GameReflexState, signal: AbortSignal): Promise<GameInputIntent>
  updateStrategy?(strategy: GameStrategy): void
  reset(): void
}

/** Safe infrastructure backend used until a calibrated policy selects an input. */
export class ObservingGameReflexPolicy implements GameReflexPolicy {
  async initialize(_context: GameCalibrationContext, _signal: AbortSignal): Promise<void> {}

  async decide(
    _frame: GameFrame,
    _state: GameReflexState,
    _signal: AbortSignal,
  ): Promise<GameInputIntent> {
    return { type: 'none' }
  }

  reset(): void {}
}
