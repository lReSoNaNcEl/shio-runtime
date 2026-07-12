import type { VrmProceduralMode } from './VrmModel'
import type { LookAtMode } from './LookAtRuntime'
import type { HeadMotionGeneratorId, HeadMotionProfile } from './HeadMotionRuntime'
import type { EarBehaviorProfile, EarGestureId, EarPose } from './EarBehaviorRuntime'

export type OverlayViewMode = 'front' | 'bust' | 'face' | 'portrait'

export const avatarStartupTuning = {
  rootPosition: { x: 0, y: 0, z: 0 },
  rootRotation: { x: 0, y: 0, z: 0 },
  camera: {
    fov: 30,
    near: 0.1,
    far: 100,
    // VRM scenes load facing -Z (glTF/three.js front-facing convention, unchanged
    // by VRMLoaderPlugin). The camera must sit on the -Z side to frame the front
    // of the model, matching the convention already used by `overlayCameraPresets`.
    position: { x: 0, y: 1.4, z: -2.5 },
    target: { x: 0, y: 1.0, z: 0 },
  }
} as const

export const overlayCameraPresets = {
  front: {
    label: 'Front',
    position: { x: 0, y: 1.48, z: -2.9 },
    target: { x: 0, y: 1.12, z: 0 },
    fov: 32,
    scaleMin: 0.65,
    scaleMax: 1.8
  },
  bust: {
    label: 'Bust',
    position: { x: 0, y: 1.5, z: -1.9 },
    target: { x: 0, y: 1.28, z: 0 },
    fov: 30,
    scaleMin: 0.75,
    scaleMax: 2
  },
  face: {
    label: 'Face',
    position: { x: 0, y: 1.58, z: -1.25 },
    target: { x: 0, y: 1.43, z: 0 },
    fov: 28,
    scaleMin: 0.75,
    scaleMax: 2.2
  },
  portrait: {
    label: 'Portrait',
    position: { x: 0, y: 1.62, z: -0.95 },
    target: { x: 0, y: 1.5, z: 0 },
    fov: 26,
    scaleMin: 0.8,
    scaleMax: 2.4
  }
} satisfies Record<OverlayViewMode, {
  label: string
  position: { x: number; y: number; z: number }
  target: { x: number; y: number; z: number }
  fov: number
  scaleMin: number
  scaleMax: number
}>

export const facialTuning = {
  debug: {
    verboseFacialFrameLogs: false
  },
  expression: {
    // Emotion domain release (fade-out) lifecycle. Rising toward a new emotion
    // uses an exponential attack; falling toward zero uses a centralized,
    // duration-based eased release so expressions fade instead of snapping.
    attackPerSecond: 6,
    releaseDurationMs: 480,
    releaseEasing: 'easeInOutCubic'
  },
  lipSync: {
    gain: 2.4,
    silenceThreshold: 0.014,
    analyserSmoothing: 0.42,
    mouthClosedBias: 0.04,
    peakLimit: 0.75,
    proceduralNoiseAmplitude: 0.028,
    proceduralNoiseSpeed: 19,
    attackPerSecond: 24,
    releasePerSecond: 28,
    silentReleasePerSecond: 48,
    detachedReleasePerSecond: 26,
    shortPauseReleasePerSecond: 64,
    shortPauseAfterMs: 64,
    significantRawThreshold: 0.12,
    suppressedFinalThreshold: 0.015,
    // Startup grace window applied at the beginning of each speech segment
    // (LipSync.attach). During it the aggressive mouth-closed bias is relaxed so
    // a quiet phrase onset is not zeroed into a "dead mouth" before the voice
    // ramps up. Steady-state tuning is unchanged after the window elapses.
    startupGraceMs: 500,
    startupGraceClosedBias: 0.02,
    // Anti-stall fallback: if audible speech is present but the resolved mouth
    // stays ~closed for too long (e.g. a soft-attack passage repeatedly zeroed by
    // the closed-mouth bias), inject a small procedural mouth motion so the mouth
    // is never fully dead while there is audible voice. Deliberately small — it
    // supplements, never replaces, normal LipSync, and disengages the moment the
    // audio goes quiet.
    antiStall: {
      enabled: true,
      // rawEnergy above which speech is considered audible (worth animating).
      minEnergy: 0.035,
      // Resolved mouth openness below which the mouth counts as "dead".
      deadThreshold: 0.045,
      // How long audible-but-dead must persist before the fallback engages.
      stallAfterMs: 170,
      recoveryAfterMs: 100,
      floor: 0.07,
      // Peak openness of the procedural fallback (small).
      amplitude: 0.07,
      // Oscillation speed of the fallback mouth motion (rad/s).
      speed: 8
    },
    statsHighThreshold: 0.7,
    statsOpenThreshold: 0.4,
    statsClosedThreshold: 0.15,
    clamps: {
      aa: 0.36,
      ih: 0.27,
      ou: 0.29,
      ee: 0.25,
      oh: 0.28
    },
    emotionProfiles: {
      whisper: { gainScale: 0.45, openBias: 0, roundBias: 0.03 },
      laugh: { gainScale: 1.12, openBias: 0.14, roundBias: 0.02 },
      gasp: { gainScale: 1.16, openBias: 0.18, roundBias: 0.03 },
      groan: { gainScale: 1.0, openBias: 0.09, roundBias: 0.12 },
      sigh: { gainScale: 0.72, openBias: 0.03, roundBias: 0.08 }
    },
    // One profile is selected at speech playback start. Long continuous
    // playback gets a slow timed refresh; only the profile transition is
    // interpolated, so the audio-driven LipSync signal remains authoritative.
    microVariation: {
      enabled: true,
      shortSpeechThresholdMs: 2000,
      longChunkRefreshMs: { min: 3000, max: 6000 },
      transitionMs: { min: 150, max: 350 },
      opennessGain: { min: 0.94, max: 1.06 },
      widthBias: { min: -0.04, max: 0.04 },
      roundnessBias: { min: -0.04, max: 0.04 },
      emotionScale: {
        neutral: 1,
        happy: 1,
        laugh: 1,
        chuckle: 0.95,
        angry: 0.85,
        sad: 0.7,
        surprised: 0.55,
        embarrassed: 0.8,
        thinking: 0.7
      },
      emotionBias: {
        happy: { width: 0.012, roundness: 0 },
        laugh: { width: 0.014, roundness: 0 },
        chuckle: { width: 0.01, roundness: 0 },
        angry: { width: 0.006, roundness: -0.012 },
        sad: { width: -0.004, roundness: 0.004 },
        surprised: { width: 0, roundness: 0 },
        embarrassed: { width: -0.004, roundness: 0.006 },
        thinking: { width: -0.004, roundness: 0.006 },
        neutral: { width: 0, roundness: 0 }
      }
    }
  },
  animation: {
    verboseTransitionLogs: false,
    minimumTransitionWeight: 0.015,
    cleanupGraceFrames: 1,
    ownershipGapWeight: 0.01
  },
  blink: {
    // Global eyelid ceiling used as a fallback when an emotion profile omits its
    // own `blinkMax`.
    blinkMax: 0.72,
    // Procedural-mode MODIFIERS. Emotion supplies the base interval / duration /
    // depth (see FacialProfile.blinkProfile); the mode only scales it. This is
    // the deliberate replacement for the old per-mode full profiles, so the
    // effective profile is composed in exactly one place
    // (resolveEffectiveBlinkProfile) and never depends on event order.
    modeModifiers: {
      idle: { intervalScale: 1, durationScale: 1, weightScale: 1 },
      speaking: { intervalScale: 0.75, durationScale: 0.92, weightScale: 0.92 }
    } satisfies Record<'idle' | 'speaking', { intervalScale: number; durationScale: number; weightScale: number }>,
    profileByMode: {
      idle: 'idle',
      listening: 'idle',
      thinking: 'idle',
      speaking: 'speaking'
    } satisfies Record<VrmProceduralMode, 'idle' | 'speaking'>,
    // Double-blink is a single sequence: blink -> short internal gap -> weaker,
    // shorter second blink -> normal cooldown. The internal gap is NOT gated by
    // the normal cooldown, so the pair reads as one event.
    sequence: {
      gapMinMs: 90,
      gapMaxMs: 170,
      secondBlinkDurationScale: 0.82,
      secondBlinkWeightScale: 0.88
    },
    forceDuration: 0.46
  },
  // Speaking Eye Micro-Expression — a subtle, slowly varying partial eye-narrow
  // layered ONLY while speaking. It never fully closes the eyes (Blink owns that)
  // and it targets a slowly drifting value so the gaze does not snap back to one
  // fixed openness after every blink. Emotion modifies the variation, never
  // replaces it.
  speakingEye: {
    enabled: true,
    // How often a new squint target is chosen (ms).
    targetIntervalMs: { min: 1200, max: 4000 },
    // Baseline partial narrow held while speaking (before per-target variation).
    // Lowered ~33% (was 0.045) so the eyes read as gently softened rather than
    // sleepy/suspicious, while still not fully open.
    baseSquint: 0.03,
    // Peak-to-peak variation applied around the baseline squint. Trimmed ~25%
    // (was 0.08) so lively drift stays but the upper peaks no longer re-create a
    // strong squint.
    opennessVariation: 0.06,
    // Maximum left/right divergence so the two eyes are never perfectly symmetric.
    asymmetry: 0.03,
    // Exponential approach speed toward the current target (soft/smooth).
    interpolationSpeed: 6.0,
    // Small non-zero floor while speaking: the eyes keep a very light living
    // squint and never snap to fully neutral-open mid-sentence.
    minSquint: 0.012,
    // Hard ceiling so the micro-expression can never approach a real blink.
    // Lowered ~35% (was 0.2) so even emotion-scaled peaks stay well-readable.
    maxSquint: 0.13,
    // Per-emotion modifiers. `squintScale` shifts the baseline narrow,
    // `variationScale` shifts how lively the drift is. Unlisted emotions use
    // `neutral`. Over-closing emotions (angry/sad) softened, surprised opened
    // further so the eyes never look half-shut or sleepy.
    emotions: {
      neutral: { squintScale: 1.0, variationScale: 1.0 },
      happy: { squintScale: 0.9, variationScale: 1.2 },
      laugh: { squintScale: 1.0, variationScale: 1.3 },
      chuckle: { squintScale: 0.95, variationScale: 1.15 },
      relaxed: { squintScale: 1.0, variationScale: 1.0 },
      sad: { squintScale: 1.1, variationScale: 0.8 },
      angry: { squintScale: 1.3, variationScale: 1.1 },
      surprised: { squintScale: 0.3, variationScale: 0.6 },
      thinking: { squintScale: 1.05, variationScale: 0.7 }
    } as Record<string, { squintScale: number; variationScale: number }>
  },
  // Mouth Closure Envelope — brief, constrained procedural lip closures layered
  // OVER the tuned LipSync output so the mouth is not permanently ajar during
  // speech. Applied as a multiplier on the final mouth value; it never rewrites
  // the LipSync signal itself.
  mouthClosure: {
    enabled: true,
    // Duration of a single closure event (ms).
    closureDurationMs: { min: 50, max: 100 },
    // Minimum spacing between closure events (ms) so they never look like jitter.
    minIntervalMs: { min: 500, max: 900 },
    // Chance a closure fires once the min interval has elapsed.
    probability: 0.2,
    // How strongly a closure suppresses the mouth (fraction of open removed at
    // the closure peak). 0.9 → mouth drops to ~10% of its lip-sync value.
    closureStrength: 0.65,
    // Speech energy above which the mouth is considered actively voicing, so
    // closures only fire while there is something to close.
    minEnergyToSpeak: 0.05,
    // Soft closure fired when speaking ends (chunk / sentence boundary), so the
    // mouth eases shut between TTS chunks instead of hanging open.
    sentenceBoundaryClosureMs: 140,
    // Startup grace window after speaking begins during which NO closure (random
    // or boundary) may fire, so a fresh phrase onset is never suppressed by the
    // closure envelope. Scheduling state is reset on the speaking edge so idle
    // accumulated time cannot trigger an immediate closure at the start.
    startupGraceMs: 600,
    minVisibleOpenness: 0.12,
    recoveryCooldownMs: 300,
    // Envelope smoothing so closures ease in/out rather than snapping.
    interpolationSpeed: 26
  },
  // Emotion-safe composition between layers. The emotion *expression* morph
  // itself already narrows the eyes (happy/angry/sad) and shapes the mouth; the
  // Speaking Eye squint and LipSync must therefore compose WITH the emotion
  // rather than blindly stack on top of it. Nothing here zeroes the emotion or
  // touches Blink — it only bounds how much each speaking layer may add.
  facialComposition: {
    // Total eye-narrow budget during speaking. The Speaking Eye squint is only
    // allowed to fill the headroom left after the active emotion's own eye
    // narrowing, so strongly narrowed emotions (angry/happy) get little-to-no
    // extra squint while open emotions (surprised/neutral) keep the full one.
    maxSpeakingSquint: 0.15,
    // Estimated eye-closing contributed per unit of each emotion *expression*
    // weight (0 = does not narrow eyes / opens them). Used to compute how much
    // headroom remains for the Speaking Eye squint.
    emotionEyeSquint: {
      happy: 0.25,
      laugh: 0.3,
      relaxed: 0.1,
      angry: 0.3,
      sad: 0.2,
      surprised: 0,
      neutral: 0
    } as Record<string, number>,
    // Per-emotion gain on the LipSync mouth signal so emotions whose profile
    // scales articulation down (sad/thinking/embarrassed/confusion/approval)
    // stay visually readable while speaking. Not a global amplitude boost:
    // well-articulating emotions stay at 1.0. Keyed by resolved FacialProfile id.
    speechMouthGain: {
      default: 1.0,
      minimum: 0.8,
      maximum: 1.4,
      byEmotion: {
        neutral: 1.0,
        // Happy's smile expression already adds visible mouth openness; keep
        // speech articulation readable without over-opening the jaw.
        happy: 0.81225,
        laugh: 1.0,
        chuckle: 1.0,
        angry: 1.0,
        surprised: 1.0,
        approval: 1.12,
        confusion: 1.12,
        thinking: 1.18,
        sad: 1.22,
        embarrassed: 1.24
      } as Record<string, number>
    }
  }
} as const

export const speakingGestureTuning = {
  intervalMs: { min: 3000, max: 6000 },
  blendDuration: 0.65,
  endingProgress: 0.82,
  longReplyEarlyWindowMs: 2800,
  emotionalPeakBehaviors: ['happy', 'laugh', 'angry', 'surprised', 'gasp'] as const,
  calmBehaviors: ['neutral', 'calm', 'warm'] as const
} as const

export const avatarLookAtTuning = {
  saccadeDurationMs: 190,
  overshootDurationMs: 210,
  overshootStrength: 0.1,
  thinkingLookAwayDurationMs: 1450,
  thinkingReturnStart: 0.55,
  headLag: {
    defaultSmoothing: 8.5,
    speakingSmoothing: 10.5,
    maxDebugMs: 220
  },
  targets: {
    idleOffset: { yaw: 0.16, pitch: 0.04 },
    thinkingOffset: { yaw: -0.24, pitch: 0.16 }
  },
  modes: {
    idle: {
      saccadeIntervalMs: { min: 680, max: 1400 },
      saccadeAmplitude: { yaw: 0.014, pitch: 0.01 },
      focusHoldMs: { min: 1100, max: 2100 },
      eyeContactBias: 0.72,
      glanceAwayChance: 0.1,
      glanceAwayDurationMs: 850
    },
    speaking: {
      saccadeIntervalMs: { min: 620, max: 1260 },
      saccadeAmplitude: { yaw: 0.012, pitch: 0.009 },
      focusHoldMs: { min: 1000, max: 1900 },
      eyeContactBias: 0.82,
      glanceAwayChance: 0.07,
      glanceAwayDurationMs: 620
    },
    listening: {
      saccadeIntervalMs: { min: 760, max: 1500 },
      saccadeAmplitude: { yaw: 0.011, pitch: 0.008 },
      focusHoldMs: { min: 1200, max: 2200 },
      eyeContactBias: 0.76,
      glanceAwayChance: 0.05,
      glanceAwayDurationMs: 720
    },
    thinking: {
      saccadeIntervalMs: { min: 820, max: 1600 },
      saccadeAmplitude: { yaw: 0.01, pitch: 0.01 },
      focusHoldMs: { min: 900, max: 1500 },
      eyeContactBias: 0.24,
      glanceAwayChance: 0,
      glanceAwayDurationMs: 0
    },
    userFocus: {
      saccadeIntervalMs: { min: 720, max: 1420 },
      saccadeAmplitude: { yaw: 0.01, pitch: 0.007 },
      focusHoldMs: { min: 1150, max: 2100 },
      eyeContactBias: 0.9,
      glanceAwayChance: 0.03,
      glanceAwayDurationMs: 520
    }
  } satisfies Record<LookAtMode, {
    saccadeIntervalMs: { min: number; max: number }
    saccadeAmplitude: { yaw: number; pitch: number }
    focusHoldMs: { min: number; max: number }
    eyeContactBias: number
    glanceAwayChance: number
    glanceAwayDurationMs: number
  }>
} as const

const generatorWeights = (
  weights: Record<HeadMotionGeneratorId, number>
): Record<HeadMotionGeneratorId, number> => weights

export const headMotionTuning = {
  randomSeed: 1847,
  yawLimit: 0.105,
  pitchLimit: 0.087,
  rollLimit: 0.07,
  smoothing: 5.6,
  neckShare: 0.34,
  headShare: 0.66,
  profiles: {
    idle: {
      generatorWeights: generatorWeights({
        idleDrift: 0.82,
        microTilt: 0.55,
        slowYaw: 0.42,
        speakingNod: 0,
        listeningTilt: 0,
        thinkingDrift: 0
      })
    },
    listening: {
      generatorWeights: generatorWeights({
        idleDrift: 0.34,
        microTilt: 0.28,
        slowYaw: 0.16,
        speakingNod: 0,
        listeningTilt: 1,
        thinkingDrift: 0
      })
    },
    thinking: {
      generatorWeights: generatorWeights({
        idleDrift: 0.18,
        microTilt: 0.2,
        slowYaw: 0.12,
        speakingNod: 0,
        listeningTilt: 0,
        thinkingDrift: 1
      })
    },
    speaking: {
      generatorWeights: generatorWeights({
        idleDrift: 0.32,
        microTilt: 0.22,
        slowYaw: 0.25,
        speakingNod: 1,
        listeningTilt: 0,
        thinkingDrift: 0
      })
    },
    userFocus: {
      generatorWeights: generatorWeights({
        idleDrift: 0.24,
        microTilt: 0.18,
        slowYaw: 0.12,
        speakingNod: 0,
        listeningTilt: 0.42,
        thinkingDrift: 0
      })
    }
  } satisfies Record<HeadMotionProfile, { generatorWeights: Record<HeadMotionGeneratorId, number> }>,
  generators: {
    idleDrift: {
      yawAmplitude: 0.026,
      pitchAmplitude: 0.015,
      rollAmplitude: 0.018,
      intervalMs: { min: 1600, max: 3600 },
      smoothing: 1.8
    },
    microTilt: {
      yawAmplitude: 0.012,
      pitchAmplitude: 0.01,
      rollAmplitude: 0.022,
      intervalMs: { min: 2400, max: 5200 },
      durationMs: { min: 420, max: 780 },
      releaseSmoothing: 5.2
    },
    slowYaw: {
      amplitude: 0.02,
      intervalMs: { min: 2800, max: 6200 },
      smoothing: 1.25
    },
    speakingNod: {
      pitchAmplitude: 0.026,
      intervalMs: { min: 900, max: 1700 },
      durationMs: { min: 260, max: 460 },
      releaseSmoothing: 8
    },
    listeningTilt: {
      pose: { yaw: 0.005, pitch: 0.018, roll: 0.026 },
      smoothing: 3.8,
      nextEventMs: 0
    },
    thinkingDrift: {
      pose: { yaw: -0.012, pitch: -0.006, roll: -0.034 },
      smoothing: 2.9,
      nextEventMs: 0
    }
  }
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
    fallbackAxis: 'y' as 'x' | 'y' | 'z'
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
    speaking: { lift: 0.08, spread: 0.02 }
  } satisfies Record<EarBehaviorProfile, EarPose>,
  profiles: {
    idle: {
      amplitude: 0.34,
      spreadAmplitude: 0.2,
      holdMs: { min: 1400, max: 4200 },
      transitionMs: { min: 420, max: 900 },
      curiosityChance: 0.5,
      activeGestures: ['curious', 'perk', 'tilt', 'emphasis']
    },
    afk: {
      amplitude: 0.26,
      spreadAmplitude: 0.14,
      holdMs: { min: 5200, max: 11000 },
      transitionMs: { min: 1100, max: 2200 },
      curiosityChance: 0.22,
      activeGestures: ['perk', 'droop', 'tilt']
    },
    listening: {
      amplitude: 0.46,
      spreadAmplitude: 0.24,
      holdMs: { min: 700, max: 1700 },
      transitionMs: { min: 240, max: 520 },
      curiosityChance: 0.72,
      activeGestures: ['perk', 'curious', 'tilt', 'emphasis']
    },
    thinking: {
      amplitude: 0.52,
      spreadAmplitude: 0.32,
      holdMs: { min: 620, max: 1500 },
      transitionMs: { min: 280, max: 620 },
      curiosityChance: 0.85,
      activeGestures: ['curious', 'tilt', 'perk', 'flatten', 'emphasis']
    },
    speaking: {
      amplitude: 0.26,
      spreadAmplitude: 0.1,
      holdMs: { min: 1400, max: 3000 },
      transitionMs: { min: 380, max: 760 },
      curiosityChance: 0.3,
      activeGestures: ['emphasis', 'perk']
    }
  } satisfies Record<EarBehaviorProfile, {
    amplitude: number
    spreadAmplitude: number
    holdMs: { min: number; max: number }
    transitionMs: { min: number; max: number }
    curiosityChance: number
    activeGestures: readonly EarGestureId[]
  }>,
  // Normalized pose library. `relaxed` is the neutral return pose picked when a
  // scheduled event is not a curiosity moment.
  gestures: {
    relaxed: { lift: -0.08, spread: 0.0 },
    perk: { lift: 0.55, spread: 0.12 },
    curious: { lift: 0.72, spread: 0.16 },
    tilt: { lift: 0.22, spread: 0.42 },
    flatten: { lift: -0.5, spread: -0.06 },
    emphasis: { lift: 0.32, spread: 0.1 },
    droop: { lift: -0.3, spread: -0.1 }
  } satisfies Record<EarGestureId, EarPose>,
  // Emotion modifiers are ADDED to the base pose (they shift it, not replace it).
  // Keyed by canonical emotion ids from emotion_manifest.json; unlisted emotions
  // fall back to neutral. amplitudeScale scales overall visible amplitude.
  emotions: {
    happy: { lift: 0.35, spread: 0.15, amplitudeScale: 1.15 },
    laugh: { lift: 0.4, spread: 0.18, amplitudeScale: 1.2 },
    chuckle: { lift: 0.28, spread: 0.12, amplitudeScale: 1.1 },
    warm: { lift: 0.18, spread: 0.08, amplitudeScale: 1.05 },
    surprised: { lift: 0.2, spread: 0.05, amplitudeScale: 1.2 },
    gasp: { lift: 0.22, spread: 0.06, amplitudeScale: 1.2 },
    angry: { lift: -0.6, spread: -0.1, amplitudeScale: 0.95 },
    sad: { lift: -0.45, spread: -0.12, amplitudeScale: 0.85 },
    crying: { lift: -0.5, spread: -0.14, amplitudeScale: 0.8 },
    fear: { lift: -0.35, spread: -0.05, amplitudeScale: 0.9 },
    embarrassed: { lift: -0.4, spread: -0.08, amplitudeScale: 0.85 }
  } as Record<string, { lift: number; spread: number; amplitudeScale: number }>
} as const
