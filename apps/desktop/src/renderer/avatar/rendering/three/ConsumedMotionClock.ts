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
  private compositorCredit = 0

  reset(): void {
    this.playbackId = ''
    this.sampleRate = 0
    this.consumed = 0
    this.position = 0
    this.priming = true
    this.compositorCredit = 0
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
      this.compositorCredit = 0
    }
    const consumedStep = consumed - this.consumed
    // Worklet reports can lag several compositor frames, including consecutive
    // frames below 50 ms. Conserve their unreported elapsed time until the
    // consumed cursor catches up; retain at most the existing 250-ms bound.
    const previousCompositorCredit = this.compositorCredit
    this.compositorCredit =
      clock.state === 'playing' && seconds >= 0 && seconds <= 0.25
        ? Math.min(
            0.25,
            Math.max(0, previousCompositorCredit + seconds - Math.max(0, consumedStep)),
          )
        : 0
    const compositorElapsed = seconds >= 0 && seconds <= 0.25 ? seconds : 0
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
    const discontinuity =
      consumed < this.consumed ||
      consumedStep > MAX_LAG + compositorElapsed + previousCompositorCredit + 1e-6
    this.consumed = consumed
    if (discontinuity) {
      // Discard skipped audible time. The owner rebases source sampling and
      // recovers an interrupted accent; no large integration step is returned.
      this.position = consumed
      this.priming = true
      this.compositorCredit = 0
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
      // Bounded presentation lag is not a jump in AudioPlayer's source clock.
      // Normal packet jitter can exceed the reserve; discard its unrendered
      // tail without interrupting the act or integrating banked time.
      this.position = consumed - RESERVE
      this.priming = false
    }
    return { offset: this.position * clock.sourceSampleRate, discontinuity }
  }
}
