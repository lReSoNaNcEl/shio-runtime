import type { GameFrame, GameSemanticEventType, GameStrategy } from '../../shared/browser-game'

const MAX_EVENTS_PER_FRAME = 4

export interface ExtractedGameEvent {
  type: GameSemanticEventType
  importance?: 'ambient' | 'normal' | 'important' | 'blocking'
  value?: number
  previousValue?: number
  label?: string
  reason?: 'user' | 'expired' | 'scope-changed' | 'blocked' | 'error' | 'completed'
}

export interface GameEventExtractionContext {
  strategy: GameStrategy
  elapsedMs: number
  inputEvents: number
}

export interface GameEventExtractor {
  extract(
    frame: GameFrame,
    state: GameEventExtractionContext,
    signal: AbortSignal,
  ): Promise<readonly ExtractedGameEvent[]>
  reset(): void
}

interface ExtractionJob {
  frame: GameFrame
  state: GameEventExtractionContext
  signal: AbortSignal
  generation: number
}

/** Single-flight latest-frame lane. Event extraction never back-pressures the reflex loop. */
export class GameEventExtractionLane {
  private pending: ExtractionJob | null = null
  private draining = false
  private generation = 0

  constructor(
    private readonly extractor: GameEventExtractor,
    private readonly onEvents: (events: readonly ExtractedGameEvent[], frame: GameFrame) => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  offer(frame: GameFrame, state: GameEventExtractionContext, signal: AbortSignal): void {
    if (signal.aborted) return
    this.pending = { frame, state, signal, generation: this.generation }
    this.startDrain()
  }

  reset(): void {
    this.generation += 1
    this.pending = null
    try {
      this.extractor.reset()
    } catch (error) {
      this.onError(error)
    }
  }

  private startDrain(): void {
    if (this.draining) return
    this.draining = true
    void this.drain()
      .catch((error) => this.onError(error))
      .finally(() => {
        this.draining = false
        if (this.pending) this.startDrain()
      })
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const job = this.pending
      this.pending = null
      let events: readonly ExtractedGameEvent[]
      try {
        events = await this.extractor.extract(job.frame, job.state, job.signal)
      } catch (error) {
        if (job.signal.aborted || job.generation !== this.generation) continue
        throw error
      }
      if (job.signal.aborted || job.generation !== this.generation) continue
      this.onEvents(events.slice(0, MAX_EVENTS_PER_FRAME), job.frame)
    }
  }
}
