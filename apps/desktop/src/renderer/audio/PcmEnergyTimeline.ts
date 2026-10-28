export interface AvailablePcmEnergy {
  startSample: number
  stepSamples: number
  energy: number[]
  finalSample: number | null
}

/** AudioPlayer-owned metadata from PCM that has actually been submitted.
 * Retains no audio. Neither metadata arrival nor ACK advances playback. */
export class PcmEnergyTimeline {
  private bins: Array<{ index: number; sum: number; count: number }> = []
  private submitted = 0
  private finalSample: number | null = null
  private readonly step: number

  constructor(private readonly sampleRate: number) {
    this.step = Math.max(1, Math.round(sampleRate * 0.05))
  }

  append(source: Float32Array, first: number, count: number): void {
    for (let i = first; i < first + count; i++) {
      const index = Math.floor(this.submitted / this.step)
      let bin = this.bins.at(-1)
      if (bin?.index !== index) {
        bin = { index, sum: 0, count: 0 }
        this.bins.push(bin)
      }
      bin.sum += source[i] * source[i]
      bin.count++
      this.submitted++
    }
    this.bins = this.bins.slice(-64)
  }

  finish(): void {
    this.finalSample = this.submitted
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
      finalSample: this.finalSample,
    }
  }
}
