import type { FacialActingValues } from '../../../../shared/facial-acting'
import type { PcmPlaybackClock } from '../../../audio/audioPlayer'
import { getFacialProfile } from './FacialProfile'

const targets: Record<string, FacialActingValues> = {
  neutral: { browInnerUp: 0.025, mouthDimpleLeft: 0.035, mouthDimpleRight: 0.035 },
  happy: {
    browOuterUpLeft: 0.18,
    browOuterUpRight: 0.16,
    eyeSquintLeft: 0.2,
    eyeSquintRight: 0.2,
    mouthSmileLeft: 0.65,
    mouthSmileRight: 0.58,
  },
  laugh: {
    browOuterUpLeft: 0.22,
    browOuterUpRight: 0.2,
    eyeSquintLeft: 0.4,
    eyeSquintRight: 0.4,
    mouthSmileLeft: 0.72,
    mouthSmileRight: 0.72,
  },
  chuckle: {
    browOuterUpLeft: 0.22,
    eyeSquintLeft: 0.26,
    eyeSquintRight: 0.2,
    mouthSmileLeft: 0.62,
    mouthSmileRight: 0.42,
    mouthDimpleLeft: 0.25,
  },
  surprised: {
    browInnerUp: 0.36,
    browOuterUpLeft: 0.48,
    browOuterUpRight: 0.43,
    eyeWideLeft: 0.72,
    eyeWideRight: 0.72,
  },
  angry: {
    browDownLeft: 0.38,
    browDownRight: 0.38,
    eyeSquintLeft: 0.12,
    eyeSquintRight: 0.12,
    mouthFrownLeft: 0.28,
    mouthFrownRight: 0.28,
  },
  sad: {
    browInnerUp: 0.3,
    browDownLeft: 0.1,
    browDownRight: 0.1,
    mouthFrownLeft: 0.48,
    mouthFrownRight: 0.48,
  },
  calm: {
    browInnerUp: 0.04,
    eyeSquintLeft: 0.08,
    eyeSquintRight: 0.08,
    mouthSmileLeft: 0.19,
    mouthSmileRight: 0.19,
  },
  embarrassed: {
    browInnerUp: 0.16,
    browOuterUpRight: 0.12,
    mouthSmileLeft: 0.35,
    mouthSmileRight: 0.24,
  },
  thinking: { browOuterUpLeft: 0.3, browDownRight: 0.14, mouthDimpleRight: 0.2 },
  approval: { browOuterUpLeft: 0.14, mouthSmileLeft: 0.32, mouthSmileRight: 0.3 },
  confusion: {
    browOuterUpLeft: 0.3,
    browDownRight: 0.16,
    eyeWideLeft: 0.16,
    mouthDimpleRight: 0.14,
  },
}

/** Temporal contribution within Facial domain; no model or expression-manager access. */
export class FacialActingController {
  private values: FacialActingValues = {}
  private variation = 1
  private asymmetry = 0
  private nextVariation = 0
  private reactionAge = 10
  private emotion = 'neutral'
  private clock: PcmPlaybackClock | null = null
  private lastPlayback = ''
  private lastOffset = 0

  constructor(private readonly random: () => number = Math.random) {}

  setClock(clock: PcmPlaybackClock | null): void {
    this.clock = clock
  }

  reset(): void {
    this.values = {}
    this.clock = null
    this.lastPlayback = ''
    this.lastOffset = 0
    this.reactionAge = 10
    this.nextVariation = 0
    this.emotion = 'neutral'
  }

  update(delta: number, emotion: string, speaking: boolean): FacialActingValues {
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(delta) ? delta : 0))
    const clock = this.clock
    let actingDt = speaking ? 0 : dt
    if (clock?.state === 'playing') {
      actingDt =
        this.lastPlayback === clock.playbackId
          ? Math.max(
              0,
              Math.min(0.1, (clock.sourceSampleOffset - this.lastOffset) / clock.sourceSampleRate),
            )
          : 0
      this.lastPlayback = clock.playbackId
      this.lastOffset = clock.sourceSampleOffset
    } else if (!speaking) {
      this.lastPlayback = ''
      this.lastOffset = 0
    }
    if (emotion !== this.emotion) {
      this.emotion = emotion
      this.reactionAge = 0
      this.nextVariation = 0
    }
    this.reactionAge += actingDt
    this.nextVariation -= actingDt
    if (this.nextVariation <= 0) {
      this.variation = 0.88 + this.random() * 0.24
      this.asymmetry = (this.random() - 0.5) * 0.14
      this.nextVariation = 1.2 + this.random() * 2.8
    }
    const target = targets[emotion] ?? targets[getFacialProfile(emotion).id] ?? targets.neutral
    const reaction = Math.max(0, 1 - this.reactionAge / 1.4)
    const next: FacialActingValues = {}
    for (const name of new Set([...Object.keys(this.values), ...Object.keys(target)])) {
      const channel = name as keyof FacialActingValues
      const side = name.endsWith('Left') ? 1 : name.endsWith('Right') ? -1 : 0
      // A reaction settles at different rates across facial regions. This is
      // emotion acting in the existing owner, never a syllable-driven actor.
      const regionalEnvelope =
        name.startsWith('eyeWide') && emotion === 'surprised'
          ? 0.7 + 0.3 * Math.exp(-this.reactionAge / 1.1)
          : name.startsWith('brow') && emotion !== 'neutral'
            ? 0.78 + 0.22 * Math.exp(-this.reactionAge / 1.5)
            : name.startsWith('mouthSmile') && ['happy', 'embarrassed'].includes(emotion)
              ? 0.88 + 0.12 * Math.exp(-this.reactionAge / 3)
              : 1
      const desired = Math.min(
        0.85,
        Math.max(
          0,
          (target[channel] ?? 0) *
            regionalEnvelope *
            (this.variation + side * this.asymmetry) *
            (1 + reaction * 0.2),
        ),
      )
      const current = this.values[channel] ?? 0
      const blend = 1 - Math.exp(-dt * (desired > current ? 10 : 5))
      const value = current + (desired - current) * blend
      if (value > 0.0001) next[channel] = value
    }
    this.values = next
    return { ...next }
  }
}
