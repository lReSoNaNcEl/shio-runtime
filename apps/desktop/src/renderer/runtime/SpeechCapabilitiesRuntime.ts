import type { EventBus } from '../../shared/runtime/events'
import type { SerializedSpeechError } from '../../shared/speech/errors'
import {
  applyHealthFailure,
  applyHealthProbe,
  applyOperationError,
  diffTransitions,
  INITIAL_SPEECH_CAPABILITIES,
  type SpeechCapabilitiesState,
  speechErrorFromResponse,
} from './speechCapabilities'

export interface SpeechCapabilitiesRuntimeDeps {
  events: EventBus
  onChange: (state: SpeechCapabilitiesState) => void
  recordRuntimeEvent: (label: string, detail?: string) => void
}

// Background recovery schedule (ТЗ §9): immediate, +2s, +5s, +10s, then every 30s.
const RETRY_OFFSETS_MS = [0, 2_000, 5_000, 10_000]
const RETRY_STEADY_MS = 30_000

/**
 * Internal read-only health component of the Desktop Runtime. It is the single
 * owner of Speech API capability state and of the background recovery probe. It
 * does not own speech execution and is not a new domain Runtime; it only
 * aggregates capability availability and publishes state-transition events.
 */
export class SpeechCapabilitiesRuntime {
  private state: SpeechCapabilitiesState = INITIAL_SPEECH_CAPABILITIES
  private probeToken = 0
  private probing = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private disposed = false

  constructor(private readonly deps: SpeechCapabilitiesRuntimeDeps) {}

  getState(): SpeechCapabilitiesState {
    return this.state
  }

  /**
   * Report a normalized failure from a runtime path (ASR/TTS/streaming). Flips
   * the affected capability, then starts the recovery scheduler for recoverable
   * failures. Does not reset an in-progress incident's retry cadence.
   */
  reportError(error: SerializedSpeechError): void {
    if (this.disposed) return
    this.commit(applyOperationError(this.state, error, Date.now()))
    if (error.recoverable) this.startScheduler()
  }

  /** Manual "Проверить снова" / "Повторить подключение": probe now, no extra timer. */
  recheck(): void {
    if (this.disposed) return
    this.clearTimer()
    this.attempt = 0
    void this.probe()
  }

  /** Delegated Controller health check. Probe now if not already running. */
  checkNow(): void {
    if (this.disposed) return
    if (this.probing) return
    void this.probe()
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
  }

  // ---- internals -----------------------------------------------------------

  private startScheduler(): void {
    if (this.disposed || this.timer !== null || this.probing) return
    this.attempt = 0
    this.scheduleNext(true)
  }

  private scheduleNext(immediate = false): void {
    if (this.disposed) return
    const delay = immediate
      ? RETRY_OFFSETS_MS[0]
      : (RETRY_OFFSETS_MS[this.attempt] ?? RETRY_STEADY_MS)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.probe()
    }, delay)
  }

  private async probe(): Promise<void> {
    if (this.disposed || this.probing) return
    this.probing = true
    const token = ++this.probeToken
    const attemptForLog = this.attempt
    try {
      const res = await window.api.health.check()
      if (this.disposed || token !== this.probeToken) return
      if (res.ok && res.capabilities) {
        this.commit(applyHealthProbe(this.state, res.capabilities, Date.now()))
      } else {
        const error = speechErrorFromResponse('health', res)
        this.commit(applyHealthFailure(this.state, error, Date.now()))
      }
    } catch (error) {
      if (this.disposed || token !== this.probeToken) return
      this.commit(
        applyHealthFailure(
          this.state,
          {
            code: 'UNKNOWN',
            operation: 'health',
            recoverable: true,
            technicalMessage: String(error),
          },
          Date.now(),
        ),
      )
    } finally {
      this.probing = false
      if (!this.disposed && token === this.probeToken) this.afterProbe(attemptForLog)
    }
  }

  private afterProbe(_attempt: number): void {
    const healthy = this.state.service === 'available' || this.state.service === 'unknown'
    if (healthy) {
      this.clearTimer()
      this.attempt = 0
      return
    }
    // Still degraded/unavailable: keep probing on the escalating cadence.
    if (this.attempt < RETRY_OFFSETS_MS.length) this.attempt += 1
    if (this.timer === null) this.scheduleNext(false)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private commit(next: SpeechCapabilitiesState): void {
    const prev = this.state
    if (next === prev) return
    this.state = next
    for (const event of diffTransitions(prev, next)) {
      this.deps.events.publish({
        type: event.type,
        category: 'speech',
        source: 'renderer.speechCapabilities',
        detail: event.detail,
      })
      this.deps.recordRuntimeEvent(event.type, event.detail)
    }
    this.deps.onChange(next)
  }
}
