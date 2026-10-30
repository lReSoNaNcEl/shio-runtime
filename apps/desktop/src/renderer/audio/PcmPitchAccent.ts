/** Bounded pitch analysis of already submitted PCM, one estimate per energy bin.
 * A decimated YIN difference function runs on at most 40 ms at the start of each
 * bin; no audio is retained after the estimate and nothing predicts future PCM. */
const ANALYSIS_RATE = 11025
const MIN_F0 = 80
const MAX_F0 = 500
const WINDOW_SECONDS = 0.04
const YIN_THRESHOLD = 0.15
const VOICED_RMS = 0.01

export class BinPitchEstimator {
  private readonly decimation: number
  private readonly rate: number
  private readonly minLag: number
  private readonly maxLag: number
  private readonly window: number
  private readonly buffer: Float32Array
  private readonly difference: Float32Array
  private filled = 0
  private accumulator = 0
  private accumulated = 0

  constructor(sampleRate: number) {
    this.decimation = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE))
    const rate = sampleRate / this.decimation
    this.minLag = Math.max(2, Math.floor(rate / MAX_F0))
    this.maxLag = Math.max(this.minLag + 1, Math.ceil(rate / MIN_F0))
    const span = Math.max(this.maxLag * 2, Math.floor(rate * WINDOW_SECONDS))
    this.window = span - this.maxLag
    this.buffer = new Float32Array(span)
    this.difference = new Float32Array(this.maxLag + 1)
    this.rate = rate
  }

  /** Starts the analysis window of a new bin. */
  begin(): void {
    this.filled = 0
    this.accumulator = 0
    this.accumulated = 0
  }

  push(sample: number): void {
    if (this.filled >= this.buffer.length) return
    this.accumulator += Number.isFinite(sample) ? sample : 0
    if (++this.accumulated < this.decimation) return
    this.buffer[this.filled++] = this.accumulator / this.decimation
    this.accumulator = 0
    this.accumulated = 0
  }

  /** Fundamental frequency in Hz of the current window, or 0 when unvoiced or too short. */
  estimate(): number {
    if (this.filled < this.buffer.length) return 0
    let energy = 0
    for (let index = 0; index < this.window; index++) energy += this.buffer[index] ** 2
    if (Math.sqrt(energy / this.window) < VOICED_RMS) return 0
    const difference = this.difference
    for (let lag = 1; lag <= this.maxLag; lag++) {
      let sum = 0
      for (let index = 0; index < this.window; index++) {
        const delta = this.buffer[index] - this.buffer[index + lag]
        sum += delta * delta
      }
      difference[lag] = sum
    }
    let running = 0
    let best = 0
    let bestValue = Number.POSITIVE_INFINITY
    for (let lag = 1; lag <= this.maxLag; lag++) {
      running += difference[lag]
      const normalized = running > 0 ? (difference[lag] * lag) / running : 1
      if (lag < this.minLag) continue
      if (normalized < bestValue) {
        bestValue = normalized
        best = lag
      }
      if (normalized < YIN_THRESHOLD) {
        // Follow the dip to its local minimum before accepting the period.
        while (best < this.maxLag) {
          const next = best + 1
          running += difference[next]
          const value = running > 0 ? (difference[next] * next) / running : 1
          if (value >= bestValue) break
          bestValue = value
          best = next
        }
        return this.rate / best
      }
    }
    return 0
  }
}

const HISTORY = 8
const ENERGY_HISTORY = 4

/** Pitch accent of each completed bin from its F0 rise over recent voiced speech,
 * weighted by a simultaneous energy rise. Values are bounded 0..1. */
export class PitchAccentTracker {
  private voiced: number[] = []
  private energies: number[] = []

  reset(): void {
    this.voiced = []
    this.energies = []
  }

  next(f0: number, rms: number): number {
    const previous = this.energies.length
      ? this.energies.reduce((sum, value) => sum + value, 0) / this.energies.length
      : rms
    this.energies.push(rms)
    if (this.energies.length > ENERGY_HISTORY) this.energies.shift()
    if (!(f0 > 0)) return 0
    const history = [...this.voiced].sort((a, b) => a - b)
    this.voiced.push(f0)
    if (this.voiced.length > HISTORY) this.voiced.shift()
    if (history.length < 3) return 0
    const median = history[Math.floor(history.length / 2)]
    const semitones = 12 * Math.log2(f0 / median)
    const pitch = Math.max(0, Math.min(1, (semitones - 1.5) / 4))
    const ratio = previous > 1e-6 ? rms / previous : 1
    const energy = Math.max(0, Math.min(1, (ratio - 0.85) / 0.5))
    return Math.round(pitch * (0.4 + 0.6 * energy) * 1000) / 1000
  }
}
