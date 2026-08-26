import sharp from 'sharp'

import type { GameEventExtractorStatus, GameFrame } from '../../shared/browser-game'
import type {
  ExtractedGameEvent,
  GameEventExtractionContext,
  GameEventExtractor,
} from './GameEventExtractor'

const SAMPLE_INTERVAL_MS = 500
const STUCK_AFTER_MS = 8_000
const MIN_INPUT_ATTEMPTS = 6
const SIGNATURE_EDGE = 32
const MEAN_DELTA_THRESHOLD = 0.012
const CHANGED_PIXEL_THRESHOLD = 16
const CHANGED_PIXEL_RATIO_THRESHOLD = 0.02

interface VisualDelta {
  mean: number
  changedRatio: number
}

/**
 * Bounded temporal detector for one claim only: repeated input against a visually
 * stable game surface. It intentionally does not infer score, death, or completion.
 */
export class LocalVisualGameEventExtractor implements GameEventExtractor {
  private lastSampleAt: number | null = null
  private stableSince: number | null = null
  private stableInputEvents = 0
  private stableSignature: Uint8Array | null = null
  private stuckReported = false

  status(): GameEventExtractorStatus {
    return {
      backendId: 'local-temporal-events-v1',
      mode: 'local-temporal',
      ready: true,
      sampleRateHz: 1_000 / SAMPLE_INTERVAL_MS,
      semanticPerception: false,
    }
  }

  async extract(
    frame: GameFrame,
    state: GameEventExtractionContext,
    signal: AbortSignal,
  ): Promise<readonly ExtractedGameEvent[]> {
    throwIfAborted(signal)
    if (this.lastSampleAt !== null && frame.capturedAt - this.lastSampleAt < SAMPLE_INTERVAL_MS) {
      return []
    }
    this.lastSampleAt = frame.capturedAt
    const signature = await this.signature(frame)
    throwIfAborted(signal)
    if (!this.stableSignature || this.stableSince === null) {
      this.beginStableWindow(signature, frame.capturedAt, state.inputEvents)
      return []
    }

    const delta = visualDelta(this.stableSignature, signature)
    if (delta.mean >= MEAN_DELTA_THRESHOLD || delta.changedRatio >= CHANGED_PIXEL_RATIO_THRESHOLD) {
      this.beginStableWindow(signature, frame.capturedAt, state.inputEvents)
      return []
    }

    if (
      !this.stuckReported &&
      frame.capturedAt - this.stableSince >= STUCK_AFTER_MS &&
      state.inputEvents - this.stableInputEvents >= MIN_INPUT_ATTEMPTS
    ) {
      this.stuckReported = true
      return [{ type: 'stuck', importance: 'normal', label: 'visual-state-stable' }]
    }
    return []
  }

  reset(): void {
    this.lastSampleAt = null
    this.stableSince = null
    this.stableInputEvents = 0
    this.stableSignature = null
    this.stuckReported = false
  }

  private async signature(frame: GameFrame): Promise<Uint8Array> {
    const bytes = await sharp(frame.image.bytes)
      .resize(SIGNATURE_EDGE, SIGNATURE_EDGE, { fit: 'fill', kernel: 'nearest' })
      .grayscale()
      .raw()
      .toBuffer()
    return new Uint8Array(bytes)
  }

  private beginStableWindow(signature: Uint8Array, at: number, inputEvents: number): void {
    this.stableSignature = signature
    this.stableSince = at
    this.stableInputEvents = inputEvents
    this.stuckReported = false
  }
}

function visualDelta(reference: Uint8Array, current: Uint8Array): VisualDelta {
  if (reference.length !== current.length || reference.length === 0) {
    return { mean: 1, changedRatio: 1 }
  }
  let total = 0
  let changed = 0
  for (let index = 0; index < reference.length; index += 1) {
    const delta = Math.abs((reference[index] ?? 0) - (current[index] ?? 0))
    total += delta
    if (delta >= CHANGED_PIXEL_THRESHOLD) changed += 1
  }
  return {
    mean: total / (reference.length * 255),
    changedRatio: changed / reference.length,
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}
