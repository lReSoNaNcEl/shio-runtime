import type { PcmPlaybackClock } from '../../../audio/audioPlayer'

const RESERVE = 1 / 30
const MAX_LAG = 0.05

/** Resamples only already consumed audio. This is a body presentation cursor,
 * never a replacement for AudioPlayer's authoritative PCM clock. */
export class ConsumedMotionClock {
  private playbackId = ''
  private sampleRate = 0
  private consumed = 0
  private position = 0
  private priming = true

  reset(): void {
    this.playbackId = ''
    this.sampleRate = 0
    this.consumed = 0
    this.position = 0
    this.priming = true
  }

  sample(
    clock: PcmPlaybackClock | null,
    seconds: number,
  ): { offset: number; discontinuity: boolean } | null {
    if (!clock || clock.state === 'ended' || clock.state === 'cancelled') {
      this.reset()
      return null
    }
    const consumed = clock.sourceSampleOffset / clock.sourceSampleRate
    const dt = Math.max(0, Math.min(0.05, seconds))
    if (clock.playbackId !== this.playbackId || clock.sourceSampleRate !== this.sampleRate) {
      this.playbackId = clock.playbackId
      this.sampleRate = clock.sourceSampleRate
      this.consumed = consumed
      this.position = consumed
      this.priming = true
    }
    const consumedStep = consumed - this.consumed
    if (
      clock.state === 'playing' &&
      this.priming &&
      consumedStep >= 0 &&
      consumedStep <= MAX_LAG &&
      consumed - this.position >= RESERVE
    ) {
      // A coarse first report can straddle the reserve. Discard only its excess
      // priming interval instead of repeatedly resetting before playback starts.
      this.position = Math.max(this.position, consumed - RESERVE)
      this.priming = false
    }
    if (
      clock.state === 'playing' &&
      seconds > 0.05 &&
      seconds <= 0.25 &&
      consumedStep > 0 &&
      consumedStep <= seconds + RESERVE &&
      consumed - this.position > MAX_LAG
    ) {
      // A slow compositor frame is different from a jump in the audio clock.
      // Drop its unrendered interval, retaining the same bounded reserve. The
      // physical integrator still limits its own step to 50 ms; phase/expiry
      // observes consumed time rather than freezing indefinitely at low FPS.
      this.consumed = consumed
      this.position = Math.max(this.position, consumed - RESERVE)
      this.priming = false
      return { offset: this.position * clock.sourceSampleRate, discontinuity: false }
    }
    let discontinuity = consumed < this.consumed || consumed - this.position > MAX_LAG + dt + 1e-6
    this.consumed = consumed
    if (discontinuity) {
      // Discard skipped audible time. The owner rebases source sampling and
      // recovers an interrupted accent; no large integration step is returned.
      this.position = consumed
      this.priming = true
    }
    if (clock.state === 'playing' && !discontinuity) {
      const available = Math.max(0, consumed - this.position)
      if (this.priming && available >= RESERVE) this.priming = false
      if (!this.priming) {
        // A slow, bounded phase correction accommodates oscillator drift without
        // encoding the worklet's packet cadence into joint velocity.
        const rate = 1 + Math.max(-0.05, Math.min(0.05, 2 * (available - RESERVE - dt)))
        this.position += Math.min(available, dt * rate)
        if (available <= dt * rate) this.priming = true
      }
    }
    if (consumed - this.position > MAX_LAG + 1e-6) {
      this.position = consumed
      this.priming = true
      discontinuity = true
    }
    return { offset: this.position * clock.sourceSampleRate, discontinuity }
  }
}
