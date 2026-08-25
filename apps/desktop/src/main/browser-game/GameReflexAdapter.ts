import type {
  GameFrame,
  GameInputIntent,
  GameSessionScope,
  GameStrategy,
} from '../../shared/browser-game'
import type { GameReflexState } from './GameReflexPolicy'

export type GameReflexBackendMode = 'observe-only' | 'local-visual' | 'low-frequency-semantic'

export interface GameReflexBackendStatus {
  backendId: string
  mode: GameReflexBackendMode
  ready: boolean
  detail?: string
}

export interface GameReflexAdapterInitialization {
  goal: string
  strategy: GameStrategy
  scope: GameSessionScope
}

/**
 * Replaceable reflex technology. It receives only cropped transient game frames and
 * returns one bounded intent; it owns no Action authority, session scope, or input dispatch.
 */
export interface GameReflexAdapter {
  status(): GameReflexBackendStatus
  initialize(context: GameReflexAdapterInitialization, signal: AbortSignal): Promise<void>
  decide(frame: GameFrame, state: GameReflexState, signal: AbortSignal): Promise<GameInputIntent>
  updateStrategy?(strategy: GameStrategy): void
  reset(): void
}

export class ObservingGameReflexAdapter implements GameReflexAdapter {
  status(): GameReflexBackendStatus {
    return {
      backendId: 'observe-only',
      mode: 'observe-only',
      ready: false,
      detail: 'A calibrated game reflex backend is not configured.',
    }
  }

  async initialize(
    _context: GameReflexAdapterInitialization,
    _signal: AbortSignal,
  ): Promise<void> {}

  async decide(
    _frame: GameFrame,
    _state: GameReflexState,
    _signal: AbortSignal,
  ): Promise<GameInputIntent> {
    return { type: 'none' }
  }

  reset(): void {}
}
