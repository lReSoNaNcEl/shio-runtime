import sharp from 'sharp'

import type {
  GameFrame,
  GameInputIntent,
  GameReflexBackendStatus,
  GameSessionScope,
  GameStrategy,
} from '../../shared/browser-game'
import type { GameReflexAdapter, GameReflexAdapterInitialization } from './GameReflexAdapter'
import type { GameReflexState } from './GameReflexPolicy'

const ANALYSIS_MAX_EDGE = 192

interface Point {
  x: number
  y: number
}

interface Candidate extends Point {
  score: number
}

interface StrategyTiming {
  minimumIntentIntervalMs: number
  reacquireDelayMs: number
  sameTargetRetryMs: number
}

const STRATEGY_TIMING: Record<GameStrategy, StrategyTiming> = {
  careful: {
    minimumIntentIntervalMs: 650,
    reacquireDelayMs: 1_000,
    sameTargetRetryMs: 1_600,
  },
  balanced: {
    minimumIntentIntervalMs: 350,
    reacquireDelayMs: 750,
    sameTargetRetryMs: 1_100,
  },
  fast: {
    minimumIntentIntervalMs: 180,
    reacquireDelayMs: 500,
    sameTargetRetryMs: 700,
  },
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function enqueuePixel(
  neighbor: number,
  mask: Uint8Array,
  visited: Uint8Array,
  queue: Int32Array,
  queueLength: number,
): number {
  if (mask[neighbor] === 0 || visited[neighbor] === 1) return queueLength
  visited[neighbor] = 1
  queue[queueLength] = neighbor
  return queueLength + 1
}

/**
 * Small local fast-loop backend for bounded pointer-target games. It analyses only
 * the transient cropped frame, never calls Character/VLM, and returns one scoped intent.
 */
export class LocalVisualTargetReflexAdapter implements GameReflexAdapter {
  private scope: GameSessionScope | null = null
  private strategy: GameStrategy = 'balanced'
  private pointerAllowed = false
  private lastFrameId = -1
  private lastIntentAt = Number.NEGATIVE_INFINITY
  private lastCandidateSeenAt: number | undefined
  private lastTarget: Point | undefined
  private sameTargetRetries = 0
  private reacquireUsed = false

  status(): GameReflexBackendStatus {
    return {
      backendId: 'local-visual-targets-v1',
      mode: 'local-visual',
      ready: true,
      supportedInputs: ['pointer'],
      semanticPerception: false,
    }
  }

  async initialize(context: GameReflexAdapterInitialization, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    this.reset()
    this.scope = context.scope
    this.strategy = context.strategy
    this.pointerAllowed = context.scope.allowedInputs.includes('pointer')
  }

  async decide(
    frame: GameFrame,
    state: GameReflexState,
    signal: AbortSignal,
  ): Promise<GameInputIntent> {
    signal.throwIfAborted()
    if (
      !this.pointerAllowed ||
      !this.scope ||
      frame.sessionId !== this.scope.sessionId ||
      frame.frameId <= this.lastFrameId
    ) {
      return { type: 'none' }
    }
    this.lastFrameId = frame.frameId
    this.strategy = state.strategy
    const candidate = await this.findCandidate(frame, signal)
    signal.throwIfAborted()
    return this.intentFor(candidate, frame)
  }

  updateStrategy(strategy: GameStrategy): void {
    this.strategy = strategy
  }

  reset(): void {
    this.scope = null
    this.pointerAllowed = false
    this.lastFrameId = -1
    this.lastIntentAt = Number.NEGATIVE_INFINITY
    this.lastCandidateSeenAt = undefined
    this.lastTarget = undefined
    this.sameTargetRetries = 0
    this.reacquireUsed = false
  }

  private async findCandidate(frame: GameFrame, signal: AbortSignal): Promise<Candidate | null> {
    const result = await sharp(frame.image.bytes)
      .resize({
        width: ANALYSIS_MAX_EDGE,
        height: ANALYSIS_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    signal.throwIfAborted()

    const { width, height, channels } = result.info
    const pixels = width * height
    const mask = new Uint8Array(pixels)
    for (let index = 0; index < pixels; index += 1) {
      const offset = index * channels
      const red = result.data[offset] ?? 0
      const green = result.data[offset + 1] ?? 0
      const blue = result.data[offset + 2] ?? 0
      const maximum = Math.max(red, green, blue)
      const minimum = Math.min(red, green, blue)
      const chroma = maximum - minimum
      if (maximum >= 120 && chroma >= 50 && chroma / Math.max(1, maximum) >= 0.35) {
        mask[index] = 1
      }
    }

    const visited = new Uint8Array(pixels)
    const queue = new Int32Array(pixels)
    const minimumArea = Math.max(8, Math.floor(pixels * 0.0015))
    const maximumArea = Math.floor(pixels * 0.18)
    let best: Candidate | null = null
    for (let start = 0; start < pixels; start += 1) {
      if (mask[start] === 0 || visited[start] === 1) continue
      visited[start] = 1
      let cursor = 0
      let queueLength = 1
      queue[0] = start
      let area = 0
      let sumX = 0
      let sumY = 0
      let minimumX = width
      let maximumX = 0
      let minimumY = height
      let maximumY = 0
      while (cursor < queueLength) {
        const current = queue[cursor++] ?? 0
        const x = current % width
        const y = Math.floor(current / width)
        area += 1
        sumX += x
        sumY += y
        minimumX = Math.min(minimumX, x)
        maximumX = Math.max(maximumX, x)
        minimumY = Math.min(minimumY, y)
        maximumY = Math.max(maximumY, y)
        if (x > 0) queueLength = enqueuePixel(current - 1, mask, visited, queue, queueLength)
        if (x + 1 < width) {
          queueLength = enqueuePixel(current + 1, mask, visited, queue, queueLength)
        }
        if (y > 0) queueLength = enqueuePixel(current - width, mask, visited, queue, queueLength)
        if (y + 1 < height) {
          queueLength = enqueuePixel(current + width, mask, visited, queue, queueLength)
        }
      }
      if (area < minimumArea || area > maximumArea) continue
      if (minimumX <= 1 || minimumY <= 1 || maximumX >= width - 2 || maximumY >= height - 2) {
        continue
      }
      const componentWidth = maximumX - minimumX + 1
      const componentHeight = maximumY - minimumY + 1
      const aspect = Math.max(componentWidth / componentHeight, componentHeight / componentWidth)
      if (aspect > 5) continue
      const score = area / (1 + Math.max(0, aspect - 1) * 0.25)
      if (!best || score > best.score) {
        best = {
          x: ((sumX / area + 0.5) / width) * frame.width,
          y: ((sumY / area + 0.5) / height) * frame.height,
          score,
        }
      }
    }
    return best
  }

  private intentFor(candidate: Candidate | null, frame: GameFrame): GameInputIntent {
    const at = frame.capturedAt
    const timing = STRATEGY_TIMING[this.strategy]
    if (candidate) {
      this.lastCandidateSeenAt = at
      const target = { x: candidate.x, y: candidate.y }
      const movementThreshold = Math.max(4, Math.min(frame.width, frame.height) * 0.025)
      const moved = !this.lastTarget || distance(target, this.lastTarget) >= movementThreshold
      this.reacquireUsed = false
      if (moved) this.sameTargetRetries = 0
      if (at - this.lastIntentAt < timing.minimumIntentIntervalMs) return { type: 'none' }
      if (moved || at - this.lastIntentAt >= timing.sameTargetRetryMs) {
        if (!moved) {
          if (this.sameTargetRetries >= 1) return { type: 'none' }
          this.sameTargetRetries += 1
        }
        this.lastTarget = target
        this.lastIntentAt = at
        return { type: 'pointer-tap', ...target }
      }
      return { type: 'none' }
    }

    if (
      this.lastTarget &&
      this.lastCandidateSeenAt !== undefined &&
      !this.reacquireUsed &&
      at - this.lastCandidateSeenAt >= timing.reacquireDelayMs &&
      at - this.lastIntentAt >= timing.minimumIntentIntervalMs
    ) {
      this.reacquireUsed = true
      this.lastIntentAt = at
      return { type: 'pointer-tap', ...this.lastTarget }
    }
    return { type: 'none' }
  }
}
