import type { GameEventExtractorStatus, GameFrame } from '../../shared/browser-game'
import { mainLog } from '../logging/safeLogger'
import type {
  ExtractedGameEvent,
  GameEventExtractionContext,
  GameEventExtractor,
} from './GameEventExtractor'
import type {
  GameSemanticPerceptionAdapter,
  GameSemanticPerceptionSnapshot,
} from './GameSemanticPerceptionAdapter'

const MINIMUM_CONFIDENCE = 0.7
const MAX_BUFFERED_EVENTS = 4

/** Keeps the local detector responsive while semantic vision runs in a separate bounded lane. */
export class HybridGameEventExtractor implements GameEventExtractor {
  private generation = 0
  private semanticInFlight = false
  private semanticAbort: AbortController | null = null
  private lastSemanticSampleAt: number | null = null
  private previousSemantic: GameSemanticPerceptionSnapshot | null = null
  private completedSemanticEvents: ExtractedGameEvent[] = []

  constructor(
    private readonly local: GameEventExtractor,
    private readonly semantic: GameSemanticPerceptionAdapter,
  ) {}

  status(): GameEventExtractorStatus {
    const semantic = this.semantic.status()
    if (!semantic.ready) return this.local.status()
    return {
      backendId: `hybrid-${semantic.backendId}`.slice(0, 100),
      mode: 'low-frequency-semantic',
      ready: true,
      sampleRateHz: semantic.sampleRateHz,
      semanticPerception: true,
    }
  }

  async extract(
    frame: GameFrame,
    state: GameEventExtractionContext,
    signal: AbortSignal,
  ): Promise<readonly ExtractedGameEvent[]> {
    const local = await this.local.extract(frame, state, signal)
    signal.throwIfAborted()
    const completed = this.completedSemanticEvents.splice(
      0,
      Math.max(0, MAX_BUFFERED_EVENTS - local.length),
    )
    this.offerSemantic(frame, state, signal)
    return [...local, ...completed].slice(0, MAX_BUFFERED_EVENTS)
  }

  reset(): void {
    this.generation += 1
    this.semanticAbort?.abort()
    this.semanticAbort = null
    this.semanticInFlight = false
    this.lastSemanticSampleAt = null
    this.previousSemantic = null
    this.completedSemanticEvents = []
    this.local.reset()
    this.semantic.reset()
  }

  private offerSemantic(
    frame: GameFrame,
    state: GameEventExtractionContext,
    signal: AbortSignal,
  ): void {
    const status = this.semantic.status()
    const intervalMs =
      status.sampleRateHz > 0 ? 1_000 / status.sampleRateHz : Number.POSITIVE_INFINITY
    if (
      !status.ready ||
      this.semanticInFlight ||
      (this.lastSemanticSampleAt !== null &&
        frame.capturedAt - this.lastSemanticSampleAt < intervalMs)
    ) {
      return
    }
    this.semanticInFlight = true
    this.lastSemanticSampleAt = frame.capturedAt
    const generation = this.generation
    const controller = new AbortController()
    this.semanticAbort = controller
    const combinedSignal = AbortSignal.any([signal, controller.signal])
    const previous = this.previousSemantic
    void this.semantic
      .analyze(frame, state, previous, combinedSignal)
      .then((snapshot) => {
        if (!snapshot || combinedSignal.aborted || generation !== this.generation) return
        if (snapshot.confidence < MINIMUM_CONFIDENCE) return
        const events = semanticEvents(previous, snapshot, frame.capturedAt)
        this.previousSemantic = snapshot
        this.completedSemanticEvents.push(...events)
        if (this.completedSemanticEvents.length > MAX_BUFFERED_EVENTS) {
          this.completedSemanticEvents.splice(
            0,
            this.completedSemanticEvents.length - MAX_BUFFERED_EVENTS,
          )
        }
      })
      .catch((error: unknown) => {
        if (combinedSignal.aborted || generation !== this.generation) return
        mainLog.warn('[BrowserGame] semantic perception failed', {
          code:
            error && typeof error === 'object' && 'code' in error
              ? String(error.code).slice(0, 100)
              : error instanceof Error
                ? error.name
                : 'UNKNOWN',
        })
      })
      .finally(() => {
        if (generation !== this.generation) return
        this.semanticInFlight = false
        if (this.semanticAbort === controller) this.semanticAbort = null
      })
  }
}

function semanticEvents(
  previous: GameSemanticPerceptionSnapshot | null,
  current: GameSemanticPerceptionSnapshot,
  observedAt: number,
): ExtractedGameEvent[] {
  const details = {
    ...(current.label ? { label: current.label } : {}),
    observedAt,
  }
  const events: ExtractedGameEvent[] = []
  if (
    previous &&
    previous.score !== null &&
    current.score !== null &&
    previous.score !== current.score
  ) {
    events.push({
      type: 'score-changed',
      importance: 'ambient',
      previousValue: previous.score,
      value: current.score,
      ...details,
    })
  }
  if (
    previous &&
    previous.lives !== null &&
    current.lives !== null &&
    current.lives < previous.lives
  ) {
    events.push({
      type: 'life-lost',
      importance: 'normal',
      previousValue: previous.lives,
      value: current.lives,
      ...details,
    })
    if (current.lives === 0) events.push({ type: 'death', importance: 'important', ...details })
  }
  if (previous && current.checkpoint && current.checkpoint !== previous.checkpoint) {
    events.push({ type: 'checkpoint', importance: 'normal', ...details })
  }
  if (previous && current.levelCompleted && !previous.levelCompleted) {
    events.push({ type: 'level-completed', importance: 'important', ...details })
  }
  if (previous && current.newRecord && !previous.newRecord) {
    events.push({ type: 'new-record', importance: 'important', ...details })
  }
  if (previous && current.phase === 'round-start' && previous.phase !== 'round-start') {
    events.push({ type: 'round-started', importance: 'normal', ...details })
  }
  if (previous && current.phase === 'game-over' && previous.phase !== 'game-over') {
    events.push({ type: 'game-over', importance: 'important', ...details })
  }
  if (
    previous?.phase === 'game-over' &&
    (current.phase === 'playing' || current.phase === 'round-start')
  ) {
    events.push({ type: 'retry', importance: 'ambient', ...details })
  }
  return events.slice(0, MAX_BUFFERED_EVENTS)
}
