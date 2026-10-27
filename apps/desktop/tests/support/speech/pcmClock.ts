import type { PcmPlaybackClock } from '../../../src/renderer/audio/audioPlayer'

export function createPcmPlaybackClock(
  overrides: Partial<PcmPlaybackClock> = {},
): PcmPlaybackClock {
  return {
    turnId: 'turn-a',
    playbackId: 'pcm-a',
    sourceSampleRate: 44100,
    sourceSampleOffset: 0,
    state: 'buffering',
    ...overrides,
  }
}
