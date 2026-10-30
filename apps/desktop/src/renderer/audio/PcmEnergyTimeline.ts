import { BinPitchEstimator, PitchAccentTracker } from './PcmPitchAccent'

export interface AvailablePcmEnergy {
  startSample: number
  stepSamples: number
  energy: number[]
  /** Pitch accent per energy bin (0..1), aligned with `energy`. */
  accent: number[]
  finalSample: number | null
}

interface EnergyBin {
  index: number
  sum: number
  count: number
  accent: number | null
}

/** AudioPlayer-owned metadata from PCM that has actually been submitted.
 * Retains no audio. Neither metadata arrival nor ACK advances playback. */
export class PcmEnergyTimeline {
  private bins: EnergyBin[] = []
  private submitted = 0
  private finalSample: number | null = null
  private readonly step: number
  private readonly pitch: BinPitchEstimator
  private readonly accents = new PitchAccentTracker()

  constructor(private readonly sampleRate: number) {
    this.step = Math.max(1, Math.round(sampleRate * 0.05))
    this.pitch = new BinPitchEstimator(sampleRate)
  }

  append(source: Float32Array, first: number, count: number): void {
    for (let i = first; i < first + count; i++) {
      const index = Math.floor(this.submitted / this.step)
      let bin = this.bins.at(-1)
      if (bin?.index !== index) {
        if (bin) this.completeBin(bin)
        bin = { index, sum: 0, count: 0, accent: null }
        this.bins.push(bin)
        this.pitch.begin()
      }
      bin.sum += source[i] * source[i]
      bin.count++
      this.pitch.push(source[i])
      this.submitted++
      if (bin.count === this.step) this.completeBin(bin)
    }
    this.bins = this.bins.slice(-64)
  }

  finish(): void {
    this.finalSample = this.submitted
    const last = this.bins.at(-1)
    if (last) this.completeBin(last)
  }

  private completeBin(bin: EnergyBin): void {
    if (bin.accent !== null) return
    bin.accent = this.accents.next(this.pitch.estimate(), Math.sqrt(bin.sum / bin.count))
  }

  snapshot(consumed: number, reference: number): AvailablePcmEnergy | undefined {
    const bins = this.bins
      .filter(
        (bin) =>
          bin.index * this.step + bin.count > consumed &&
          bin.index * this.step < consumed + this.sampleRate * 1.5 &&
          (bin.count === this.step || this.finalSample !== null),
      )
      .slice(0, 30)
    if (!bins.length) return undefined
    return {
      startSample: bins[0].index * this.step,
      stepSamples: this.step,
      energy: bins.map((bin) =>
        Math.min(1, Math.sqrt(bin.sum / bin.count) / Math.max(0.04, reference)),
      ),
      accent: bins.map((bin) => bin.accent ?? 0),
      finalSample: this.finalSample,
    }
  }
}
