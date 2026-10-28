import type { MotionProsody } from '../../../../shared/motion'
import type { PcmPlaybackClock } from '../../../audio/audioPlayer'

/** Consumed origin plus bounded, already submitted PCM metadata.
 * It never predicts unavailable audio or chooses a semantic gesture. */
export class ConsumedSpeechProsody {
  private playbackId = ''
  private samples: Array<{ offset: number; energy: number }> = []
  private onset = 0
  private quietSince: number | null = null
  private accentAt = -Infinity
  private accent = 0

  reset(): void {
    this.playbackId = ''
    this.samples = []
    this.quietSince = null
    this.accentAt = -Infinity
    this.accent = 0
  }

  observe(clock: PcmPlaybackClock | null, energy: number): void {
    if (clock?.state !== 'playing' || clock.sourceSampleOffset <= 0) return
    if (clock.playbackId !== this.playbackId) {
      this.reset()
      this.playbackId = clock.playbackId
      this.onset = clock.sourceSampleOffset
    }
    const previous = this.samples.at(-1)
    const offset = clock.sourceSampleOffset
    // Render ticks and repeated worklet messages do not advance prosody.
    if (previous && offset - previous.offset < clock.sourceSampleRate * 0.05) return
    const value = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0
    const average =
      this.samples.reduce((sum, sample) => sum + sample.energy, 0) /
      Math.max(1, this.samples.length)
    const seconds = offset / clock.sourceSampleRate
    if (value < 0.025) this.quietSince ??= seconds
    else this.quietSince = null
    // A sustained envelope rise may modulate an existing act, at most twice
    // per second. Individual syllables never create gestures or head nods.
    if (
      this.samples.length >= 3 &&
      value > Math.max(0.08, average * 1.35) &&
      seconds - this.accentAt >= 0.65
    ) {
      this.accentAt = seconds
      this.accent = Math.min(1, (value - average) * 3)
    }
    this.samples.push({ offset, energy: value })
    this.samples = this.samples
      .filter((sample) => offset - sample.offset <= clock.sourceSampleRate * 0.9)
      .slice(-12)
  }

  snapshot(clock: PcmPlaybackClock | null, leadFrames: number): MotionProsody | undefined {
    const last = this.samples.at(-1)
    if (
      clock?.state !== 'playing' ||
      clock.playbackId !== this.playbackId ||
      !last ||
      clock.sourceSampleOffset < last.offset
    )
      return undefined
    const seconds = clock.sourceSampleOffset / clock.sourceSampleRate
    const age = (clock.sourceSampleOffset - last.offset) / clock.sourceSampleRate
    const leadMs = Math.max(0, Math.min(4000, (leadFrames * 1000) / 30))
    return {
      throughSample: last.offset,
      sampleRate: clock.sourceSampleRate,
      envelope: this.samples.map((sample) => sample.energy),
      phase:
        this.quietSince !== null && seconds - this.quietSince >= 0.18
          ? 'pause'
          : clock.sourceSampleOffset - this.onset < clock.sourceSampleRate * 0.25
            ? 'onset'
            : 'speech',
      accent:
        leadMs <= 250 && age <= 0.15
          ? this.accent * Math.max(0, 1 - (seconds - this.accentAt) / 0.25)
          : 0,
      leadMs,
      available: clock.availableEnergy,
    }
  }
}
