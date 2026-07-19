import type { AvatarProceduralMode } from '../embodiment/types'

export const facialTuning = {
  debug: {
    verboseFacialFrameLogs: false,
  },
  expression: {
    // Emotion domain release (fade-out) lifecycle. Rising toward a new emotion
    // uses an exponential attack; falling toward zero uses a centralized,
    // duration-based eased release so expressions fade instead of snapping.
    attackPerSecond: 6,
    releaseDurationMs: 480,
    releaseEasing: 'easeInOutCubic',
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
      speed: 8,
    },
    statsHighThreshold: 0.7,
    statsOpenThreshold: 0.4,
    statsClosedThreshold: 0.15,
    clamps: {
      aa: 0.36,
      ih: 0.27,
      ou: 0.29,
      ee: 0.25,
      oh: 0.28,
    },
    emotionProfiles: {
      whisper: { gainScale: 0.45, openBias: 0, roundBias: 0.03 },
      laugh: { gainScale: 1.12, openBias: 0.14, roundBias: 0.02 },
      gasp: { gainScale: 1.16, openBias: 0.18, roundBias: 0.03 },
      groan: { gainScale: 1.0, openBias: 0.09, roundBias: 0.12 },
      sigh: { gainScale: 0.72, openBias: 0.03, roundBias: 0.08 },
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
        calm: 0.75,
        embarrassed: 0.8,
        thinking: 0.7,
      },
      emotionBias: {
        happy: { width: 0.012, roundness: 0 },
        laugh: { width: 0.014, roundness: 0 },
        chuckle: { width: 0.01, roundness: 0 },
        angry: { width: 0.006, roundness: -0.012 },
        sad: { width: -0.004, roundness: 0.004 },
        surprised: { width: 0, roundness: 0 },
        calm: { width: -0.003, roundness: 0.003 },
        embarrassed: { width: -0.004, roundness: 0.006 },
        thinking: { width: -0.004, roundness: 0.006 },
        neutral: { width: 0, roundness: 0 },
      },
    },
  },
  animation: {
    verboseTransitionLogs: false,
    minimumTransitionWeight: 0.015,
    cleanupGraceFrames: 1,
    ownershipGapWeight: 0.01,
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
      speaking: { intervalScale: 0.75, durationScale: 0.92, weightScale: 0.92 },
    } satisfies Record<
      'idle' | 'speaking',
      { intervalScale: number; durationScale: number; weightScale: number }
    >,
    profileByMode: {
      idle: 'idle',
      listening: 'idle',
      thinking: 'idle',
      speaking: 'speaking',
    } satisfies Record<AvatarProceduralMode, 'idle' | 'speaking'>,
    // Double-blink is a single sequence: blink -> short internal gap -> weaker,
    // shorter second blink -> normal cooldown. The internal gap is NOT gated by
    // the normal cooldown, so the pair reads as one event.
    sequence: {
      gapMinMs: 90,
      gapMaxMs: 170,
      secondBlinkDurationScale: 0.82,
      secondBlinkWeightScale: 0.88,
    },
    forceDuration: 0.46,
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
      thinking: { squintScale: 1.05, variationScale: 0.7 },
    } as Record<string, { squintScale: number; variationScale: number }>,
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
    interpolationSpeed: 26,
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
      neutral: 0,
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
        embarrassed: 1.24,
      } as Record<string, number>,
    },
  },
} as const
