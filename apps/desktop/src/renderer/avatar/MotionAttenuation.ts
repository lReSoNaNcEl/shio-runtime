import type { AdaptiveMotionFilterLimits } from './rendering/three/AdaptiveMotionFilter'

/** Debug-only attribution of how much each artistic or safety layer reduced a
 * requested motion. Reports are dimensionless magnitudes of one channel; poses,
 * coordinates and bones never enter the aggregate. Production uses the no-op
 * probe, and call sites check `active` before computing any magnitude. */
export const MOTION_ATTENUATION_STAGES = [
  'standing-arm-range',
  'recover-rest',
  'body-safety.workspace',
  'body-safety.contact',
  'body-safety.hinge',
  'adaptive-filter',
  'head-authority',
  'expression-mixer',
  'lipsync-clamp',
] as const
export type MotionAttenuationStage = (typeof MOTION_ATTENUATION_STAGES)[number]

export const MOTION_ATTENUATION_CHANNELS = [
  'leftHand',
  'rightHand',
  'head',
  'torso',
  'mouth',
  'brows',
] as const
export type MotionAttenuationChannel = (typeof MOTION_ATTENUATION_CHANNELS)[number]

export interface MotionAttenuationProbe {
  readonly active: boolean
  report(
    stage: MotionAttenuationStage,
    channel: MotionAttenuationChannel,
    requested: number,
    applied: number,
  ): void
}

export const NOOP_MOTION_ATTENUATION_PROBE: MotionAttenuationProbe = Object.freeze({
  active: false,
  report: () => undefined,
})

/** Maps a humanoid bone name to its attribution channel; fingers and legs are not attributed. */
export function motionAttenuationChannel(boneName: string): MotionAttenuationChannel | null {
  if (/^(left|right)(Shoulder|UpperArm|LowerArm|Hand)$/u.test(boneName))
    return boneName.startsWith('left') ? 'leftHand' : 'rightHand'
  if (boneName === 'head' || boneName === 'neck') return 'head'
  if (boneName === 'hips' || boneName === 'spine' || boneName.endsWith('Chest')) return 'torso'
  return null
}

export interface MotionAttenuationEntry {
  stage: MotionAttenuationStage
  /** Applied over requested magnitude in the window, 0..1; 1 means no reduction. */
  ratio: number
  /** Share of reports in which this stage reduced the request, 0..1. */
  limitedShare: number
  samples: number
}

export interface MotionAttenuationSnapshot {
  windowMs: number
  samples: number
  /** Reports overwritten by the bounded ring while still inside the window. */
  dropped: number
  channels: Record<MotionAttenuationChannel, MotionAttenuationEntry[]>
}

/** Debug Preview projection: the windowed attribution plus the filter envelope counters. */
export interface MotionAttenuationDebug extends MotionAttenuationSnapshot {
  filterLimits: AdaptiveMotionFilterLimits | null
}

const LIMITED_TOLERANCE = 1e-3
const MIN_REQUESTED = 1e-6
const TOP_LIMITERS = 3

export interface MotionAttenuationAggregatorOptions {
  now: () => number
  windowMs?: number
  capacity?: number
}

export class MotionAttenuationAggregator implements MotionAttenuationProbe {
  readonly active = true
  private readonly now: () => number
  private readonly windowMs: number
  private readonly capacity: number
  private readonly times: Float64Array
  private readonly stages: Uint8Array
  private readonly channels: Uint8Array
  private readonly requested: Float32Array
  private readonly applied: Float32Array
  private head = 0
  private size = 0
  private dropped = 0

  constructor(options: MotionAttenuationAggregatorOptions) {
    this.now = options.now
    this.windowMs = Math.max(1, options.windowMs ?? 1000)
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 8192))
    this.times = new Float64Array(this.capacity)
    this.stages = new Uint8Array(this.capacity)
    this.channels = new Uint8Array(this.capacity)
    this.requested = new Float32Array(this.capacity)
    this.applied = new Float32Array(this.capacity)
  }

  report(
    stage: MotionAttenuationStage,
    channel: MotionAttenuationChannel,
    requested: number,
    applied: number,
  ): void {
    if (!Number.isFinite(requested) || !Number.isFinite(applied)) return
    const magnitude = Math.abs(requested)
    if (magnitude < MIN_REQUESTED) return
    const time = this.now()
    if (this.size === this.capacity) {
      if (time - this.times[this.head] <= this.windowMs) this.dropped++
    } else this.size++
    this.times[this.head] = time
    this.stages[this.head] = MOTION_ATTENUATION_STAGES.indexOf(stage)
    this.channels[this.head] = MOTION_ATTENUATION_CHANNELS.indexOf(channel)
    this.requested[this.head] = magnitude
    this.applied[this.head] = Math.min(magnitude, Math.abs(applied))
    this.head = (this.head + 1) % this.capacity
  }

  reset(): void {
    this.head = 0
    this.size = 0
    this.dropped = 0
  }

  snapshot(): MotionAttenuationSnapshot {
    const cutoff = this.now() - this.windowMs
    const stageCount = MOTION_ATTENUATION_STAGES.length
    const cells = MOTION_ATTENUATION_CHANNELS.length * stageCount
    const requested = new Float64Array(cells)
    const applied = new Float64Array(cells)
    const counts = new Uint32Array(cells)
    const limited = new Uint32Array(cells)
    let samples = 0
    for (let offset = 0; offset < this.size; offset++) {
      const index = (this.head - 1 - offset + this.capacity) % this.capacity
      if (this.times[index] < cutoff) continue
      const cell = this.channels[index] * stageCount + this.stages[index]
      requested[cell] += this.requested[index]
      applied[cell] += this.applied[index]
      counts[cell]++
      if (this.applied[index] < this.requested[index] * (1 - LIMITED_TOLERANCE)) limited[cell]++
      samples++
    }
    const channels = Object.fromEntries(
      MOTION_ATTENUATION_CHANNELS.map((channel, channelIndex) => {
        const entries: MotionAttenuationEntry[] = []
        for (let stageIndex = 0; stageIndex < stageCount; stageIndex++) {
          const cell = channelIndex * stageCount + stageIndex
          if (counts[cell] === 0) continue
          entries.push({
            stage: MOTION_ATTENUATION_STAGES[stageIndex],
            ratio: round(Math.min(1, applied[cell] / requested[cell])),
            limitedShare: round(limited[cell] / counts[cell]),
            samples: counts[cell],
          })
        }
        entries.sort((a, b) => a.ratio - b.ratio || b.limitedShare - a.limitedShare)
        return [channel, entries.slice(0, TOP_LIMITERS)]
      }),
    ) as Record<MotionAttenuationChannel, MotionAttenuationEntry[]>
    return { windowMs: this.windowMs, samples, dropped: this.dropped, channels }
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
