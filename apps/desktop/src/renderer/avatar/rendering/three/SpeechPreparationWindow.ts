import { getMotionProfile } from '../../../../shared/motion'
import type { PcmPlaybackClock } from '../../../audio/audioPlayer'

/** Consumed-PCM origin of a speech-bound gesture preparation and its expiry.
 * Moved verbatim from GeneratedBodyPlayback. */
export interface SpeechPreparationOrigin {
  playbackId: string | null
  offset: number
}

export function speechWindowMissed(
  clock: PcmPlaybackClock | null,
  id: string,
  origin: SpeechPreparationOrigin,
): boolean {
  const profile = getMotionProfile(id)
  if (!clock || profile?.kind !== 'gesture') return false
  origin.playbackId ??= clock.playbackId
  if (origin.playbackId !== clock.playbackId) return true
  const budget = profile.phases.find((phase) => phase.id === 'prepare')
  return (
    !!budget &&
    ((clock.sourceSampleOffset - origin.offset) * 1000) / clock.sourceSampleRate > budget.maxMs
  )
}

export function captureSpeechOrigin(clock: PcmPlaybackClock | null): SpeechPreparationOrigin {
  return {
    playbackId: clock?.playbackId ?? null,
    offset: clock?.sourceSampleOffset ?? 0,
  }
}
