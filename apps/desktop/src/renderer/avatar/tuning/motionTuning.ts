import type { HeadMotionGeneratorId, HeadMotionProfile } from '../embodiment/gaze/HeadMotionRuntime'
import type { LookAtMode } from '../embodiment/gaze/LookAtRuntime'
import type { BreathProfile } from '../embodiment/motion/BreathController'
import type { MicroMotionProfile } from '../embodiment/motion/MicroMotionController'
import type {
  EarBehaviorProfile,
  EarGestureId,
  EarPose,
} from '../embodiment/secondary-motion/EarBehaviorRuntime'
import type { AvatarProceduralMode } from '../embodiment/types'

export const breathProfiles: Record<AvatarProceduralMode, BreathProfile> = {
  idle: { speed: 0.2, intensity: 0.01, weight: 1, smoothing: 3.2 },
  listening: { speed: 0.22, intensity: 0.009, weight: 0.95, smoothing: 3.4 },
  thinking: { speed: 0.17, intensity: 0.008, weight: 0.82, smoothing: 3 },
  speaking: { speed: 0.24, intensity: 0.009, weight: 1.05, smoothing: 3.6 },
}

export const microMotionProfiles: Record<AvatarProceduralMode, MicroMotionProfile> = {
  idle: {
    swayWeight: 0.7,
    postureWeight: 0.7,
    shoulderWeight: 0.52,
  },
  listening: {
    swayWeight: 0.5,
    postureWeight: 0.74,
    shoulderWeight: 0.38,
  },
  thinking: {
    swayWeight: 0.46,
    postureWeight: 0.78,
    shoulderWeight: 0.42,
  },
  speaking: {
    swayWeight: 0.62,
    postureWeight: 0.58,
    shoulderWeight: 0.46,
  },
}

export const avatarLookAtTuning = {
  saccadeDurationMs: 190,
  overshootDurationMs: 210,
  overshootStrength: 0.1,
  thinkingLookAwayDurationMs: 1450,
  thinkingReturnStart: 0.55,
  headLag: {
    defaultSmoothing: 8.5,
    speakingSmoothing: 10.5,
    maxDebugMs: 220,
  },
  targets: {
    idleOffset: { yaw: 0.16, pitch: 0.04 },
    thinkingOffset: { yaw: -0.24, pitch: 0.16 },
  },
  modes: {
    idle: {
      saccadeIntervalMs: { min: 680, max: 1400 },
      saccadeAmplitude: { yaw: 0.014, pitch: 0.01 },
      focusHoldMs: { min: 1100, max: 2100 },
      eyeContactBias: 0.72,
      glanceAwayChance: 0.1,
      glanceAwayDurationMs: 850,
    },
    speaking: {
      saccadeIntervalMs: { min: 620, max: 1260 },
      saccadeAmplitude: { yaw: 0.012, pitch: 0.009 },
      focusHoldMs: { min: 1000, max: 1900 },
      eyeContactBias: 0.82,
      glanceAwayChance: 0.07,
      glanceAwayDurationMs: 620,
    },
    listening: {
      saccadeIntervalMs: { min: 760, max: 1500 },
      saccadeAmplitude: { yaw: 0.011, pitch: 0.008 },
      focusHoldMs: { min: 1200, max: 2200 },
      eyeContactBias: 0.76,
      glanceAwayChance: 0.05,
      glanceAwayDurationMs: 720,
    },
    thinking: {
      saccadeIntervalMs: { min: 820, max: 1600 },
      saccadeAmplitude: { yaw: 0.01, pitch: 0.01 },
      focusHoldMs: { min: 900, max: 1500 },
      eyeContactBias: 0.24,
      glanceAwayChance: 0,
      glanceAwayDurationMs: 0,
    },
    userFocus: {
      saccadeIntervalMs: { min: 720, max: 1420 },
      saccadeAmplitude: { yaw: 0.01, pitch: 0.007 },
      focusHoldMs: { min: 1150, max: 2100 },
      eyeContactBias: 0.9,
      glanceAwayChance: 0.03,
      glanceAwayDurationMs: 520,
    },
    screenFocus: {
      saccadeIntervalMs: { min: 1000, max: 1800 },
      saccadeAmplitude: { yaw: 0.008, pitch: 0.006 },
      focusHoldMs: { min: 1600, max: 2600 },
      eyeContactBias: 0.96,
      glanceAwayChance: 0,
      glanceAwayDurationMs: 0,
    },
    away: {
      saccadeIntervalMs: { min: 820, max: 1500 },
      saccadeAmplitude: { yaw: 0.01, pitch: 0.008 },
      focusHoldMs: { min: 1000, max: 1900 },
      eyeContactBias: 0.45,
      glanceAwayChance: 0,
      glanceAwayDurationMs: 0,
    },
  } satisfies Record<
    LookAtMode,
    {
      saccadeIntervalMs: { min: number; max: number }
      saccadeAmplitude: { yaw: number; pitch: number }
      focusHoldMs: { min: number; max: number }
      eyeContactBias: number
      glanceAwayChance: number
      glanceAwayDurationMs: number
    }
  >,
} as const

const generatorWeights = (
  weights: Record<HeadMotionGeneratorId, number>,
): Record<HeadMotionGeneratorId, number> => weights

export const headMotionTuning = {
  randomSeed: 1847,
  yawLimit: 0.105,
  pitchLimit: 0.087,
  rollLimit: 0.07,
  smoothing: 5.6,
  neckShare: 0.34,
  headShare: 0.66,
  attentionImpulse: {
    pose: { yaw: 0.018, pitch: -0.022, roll: 0.012 },
    attackMs: 100,
    holdMs: 120,
    releaseMs: 320,
    cooldownMs: 1_000,
  },
  profiles: {
    idle: {
      generatorWeights: generatorWeights({
        idleDrift: 0.82,
        microTilt: 0.55,
        slowYaw: 0.42,
        speakingNod: 0,
        listeningTilt: 0,
        thinkingDrift: 0,
      }),
    },
    listening: {
      generatorWeights: generatorWeights({
        idleDrift: 0.34,
        microTilt: 0.28,
        slowYaw: 0.16,
        speakingNod: 0,
        listeningTilt: 1,
        thinkingDrift: 0,
      }),
    },
    thinking: {
      generatorWeights: generatorWeights({
        idleDrift: 0.18,
        microTilt: 0.2,
        slowYaw: 0.12,
        speakingNod: 0,
        listeningTilt: 0,
        thinkingDrift: 1,
      }),
    },
    speaking: {
      generatorWeights: generatorWeights({
        idleDrift: 0.32,
        microTilt: 0.22,
        slowYaw: 0.25,
        speakingNod: 1,
        listeningTilt: 0,
        thinkingDrift: 0,
      }),
    },
    userFocus: {
      generatorWeights: generatorWeights({
        idleDrift: 0.24,
        microTilt: 0.18,
        slowYaw: 0.12,
        speakingNod: 0,
        listeningTilt: 0.42,
        thinkingDrift: 0,
      }),
    },
  } satisfies Record<
    HeadMotionProfile,
    { generatorWeights: Record<HeadMotionGeneratorId, number> }
  >,
  generators: {
    idleDrift: {
      yawAmplitude: 0.026,
      pitchAmplitude: 0.015,
      rollAmplitude: 0.018,
      intervalMs: { min: 1600, max: 3600 },
      smoothing: 1.8,
    },
    microTilt: {
      yawAmplitude: 0.012,
      pitchAmplitude: 0.01,
      rollAmplitude: 0.022,
      intervalMs: { min: 2400, max: 5200 },
      durationMs: { min: 420, max: 780 },
      releaseSmoothing: 5.2,
    },
    slowYaw: {
      amplitude: 0.02,
      intervalMs: { min: 2800, max: 6200 },
      smoothing: 1.25,
    },
    speakingNod: {
      pitchAmplitude: 0.026,
      intervalMs: { min: 900, max: 1700 },
      durationMs: { min: 260, max: 460 },
      releaseSmoothing: 8,
    },
    listeningTilt: {
      pose: { yaw: 0.005, pitch: 0.018, roll: 0.026 },
      smoothing: 3.8,
      nextEventMs: 0,
    },
    thinkingDrift: {
      pose: { yaw: -0.012, pitch: -0.006, roll: -0.034 },
      smoothing: 2.9,
      nextEventMs: 0,
    },
  },
} as const

/**
 * Ear Behavior Runtime tuning.
 *
 * The runtime is pose-driven, not noise-driven: each ear procedurally transitions
 * between named poses ({@link earBehaviorTuning.gestures}) layered on a per-profile
 * base pose and modified (never replaced) by the current emotion.
 *
 * Pose values (`lift`, `spread`) are normalized (~ -1..1). `lift` perks the ear
 * forward/up when positive and flattens it back/down when negative; `spread`
 * fans the ear sideways. Normalized poses are scaled to radians by each profile's
 * `amplitude` / `spreadAmplitude`, so a single amplitude knob controls how visible
 * a state is. Angles are radians; timers milliseconds.
 */
export const earBehaviorTuning = {
  randomSeed: 20713,
  maxRotation: 0.7,
  // Hard anti-convergence clamp: however negative a pose's spread gets (sad /
  // angry droop), the ear may never fold further inward than this, so the ears
  // can never cross or overlap regardless of rig calibration.
  maxInwardSpread: 0.13,
  afkAfterMs: 45000,
  simultaneousMoveChance: 0.28,
  boneNamePatterns: ['ear', 'mimi', '耳'],
  boneNameExcludes: ['forearm', 'earring', 'gear', 'hair'],
  // Automatic rig calibration. Of the two axes perpendicular to the ear's length
  // (the twist axis is rejected), the primary "lift" axis is the one that swings
  // the tip vertically/forward (least sideways) so lift never pulls the ears
  // together; the secondary "spread" axis is the horizontal one, sign-calibrated
  // so positive spread always fans the ear OUTWARD.
  calibration: {
    tipMinLength: 0.015,
    fallbackAxis: 'y' as 'x' | 'y' | 'z',
  },
  // Randomized initial per-ear phase so the two ears never share a timeline.
  asymmetry: { minOffsetMs: 200, maxOffsetMs: 2400 },
  // Surprise spike: a fast additive lift impulse (normalized) that recovers
  // smoothly, layered on top of whatever pose is currently held.
  surpriseImpulse: { lift: 0.85, attackMs: 130, durationMs: 950 },
  // Speaking is intentionally the SMALLEST modifier: a subtle additive lift +
  // gentle outward openness layered on top of the calm speaking base pose, so
  // the ears feel a little more alive without changing what pose is held.
  speakingModifier: { lift: 0.1, spread: 0.05 },
  // Resting pose per profile (applied to both ears before gestures/emotion).
  profileBasePose: {
    idle: { lift: 0.0, spread: 0.0 },
    afk: { lift: -0.18, spread: -0.03 },
    listening: { lift: 0.62, spread: 0.12 },
    thinking: { lift: 0.28, spread: 0.16 },
    speaking: { lift: 0.08, spread: 0.02 },
  } satisfies Record<EarBehaviorProfile, EarPose>,
  profiles: {
    idle: {
      amplitude: 0.34,
      spreadAmplitude: 0.2,
      holdMs: { min: 1400, max: 4200 },
      transitionMs: { min: 420, max: 900 },
      curiosityChance: 0.5,
      activeGestures: ['curious', 'perk', 'tilt', 'emphasis'],
    },
    afk: {
      amplitude: 0.26,
      spreadAmplitude: 0.14,
      holdMs: { min: 5200, max: 11000 },
      transitionMs: { min: 1100, max: 2200 },
      curiosityChance: 0.22,
      activeGestures: ['perk', 'droop', 'tilt'],
    },
    listening: {
      amplitude: 0.46,
      spreadAmplitude: 0.24,
      holdMs: { min: 700, max: 1700 },
      transitionMs: { min: 240, max: 520 },
      curiosityChance: 0.72,
      activeGestures: ['perk', 'curious', 'tilt', 'emphasis'],
    },
    thinking: {
      amplitude: 0.52,
      spreadAmplitude: 0.32,
      holdMs: { min: 620, max: 1500 },
      transitionMs: { min: 280, max: 620 },
      curiosityChance: 0.85,
      activeGestures: ['curious', 'tilt', 'perk', 'flatten', 'emphasis'],
    },
    speaking: {
      amplitude: 0.26,
      spreadAmplitude: 0.1,
      holdMs: { min: 1400, max: 3000 },
      transitionMs: { min: 380, max: 760 },
      curiosityChance: 0.3,
      activeGestures: ['emphasis', 'perk'],
    },
  } satisfies Record<
    EarBehaviorProfile,
    {
      amplitude: number
      spreadAmplitude: number
      holdMs: { min: number; max: number }
      transitionMs: { min: number; max: number }
      curiosityChance: number
      activeGestures: readonly EarGestureId[]
    }
  >,
  // Normalized pose library. `relaxed` is the neutral return pose picked when a
  // scheduled event is not a curiosity moment.
  gestures: {
    relaxed: { lift: -0.08, spread: 0.0 },
    perk: { lift: 0.55, spread: 0.12 },
    curious: { lift: 0.72, spread: 0.16 },
    tilt: { lift: 0.22, spread: 0.42 },
    flatten: { lift: -0.5, spread: -0.06 },
    emphasis: { lift: 0.32, spread: 0.1 },
    droop: { lift: -0.3, spread: -0.1 },
  } satisfies Record<EarGestureId, EarPose>,
} as const

export const semanticEarTuning = {
  recognitionUncertainThreshold: 0.72,
  priority: {
    'user-interruption': 60,
    'direct-address': 50,
    question: 40,
    'recognition-uncertain': 30,
    'reply-emphasis': 20,
    'thinking-entry': 10,
  },
  impulses: {
    'user-interruption': {
      left: { lift: 0.52, spread: 0.06 },
      right: { lift: 0.46, spread: 0.05 },
      attackMs: 110,
      holdMs: 140,
      releaseMs: 340,
      cooldownMs: 1_000,
    },
    'direct-address': {
      left: { lift: 0.34, spread: 0.06 },
      right: { lift: 0.32, spread: 0.055 },
      attackMs: 90,
      holdMs: 180,
      releaseMs: 360,
      cooldownMs: 1_500,
    },
    question: {
      left: { lift: 0.28, spread: 0.08 },
      right: { lift: 0.1, spread: 0.03 },
      attackMs: 110,
      holdMs: 180,
      releaseMs: 340,
      cooldownMs: 1_800,
    },
    'thinking-entry': {
      left: { lift: 0.04, spread: 0.12 },
      right: { lift: 0.22, spread: 0.02 },
      attackMs: 140,
      holdMs: 180,
      releaseMs: 420,
      cooldownMs: 0,
    },
    'reply-emphasis': {
      left: { lift: 0.2, spread: 0.04 },
      right: { lift: 0.16, spread: 0.03 },
      attackMs: 70,
      holdMs: 80,
      releaseMs: 220,
      cooldownMs: 0,
    },
    'recognition-uncertain': {
      left: { lift: -0.06, spread: 0.04 },
      right: { lift: 0.16, spread: 0.01 },
      attackMs: 80,
      holdMs: 90,
      releaseMs: 280,
      cooldownMs: 2_500,
    },
  },
} as const
