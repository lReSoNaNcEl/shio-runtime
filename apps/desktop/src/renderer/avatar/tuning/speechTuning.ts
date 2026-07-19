export const phraseLipSyncTuning = {
  onsetMs: 100,
  releaseMs: 140,
  attackSmoothing: 24,
  releaseSmoothing: 18,
  visemeSwitchSmoothing: 20,
  jawSmoothing: 12,
  neutralEpsilon: 0.01,
  jawScale: { min: 0.72, max: 1.15 },
  softBoundary: {
    closureStrength: 0.26,
    durationMs: 70,
  },
  sentenceBoundary: {
    closureStrength: 0.72,
    durationMs: 120,
  },
  emotionProfiles: {
    neutral: { articulationScale: 1, jawScale: 1, widthScale: 1, attackScale: 1 },
    happy: { articulationScale: 1.07, jawScale: 1.03, widthScale: 1.06, attackScale: 1.08 },
    sad: { articulationScale: 0.94, jawScale: 0.86, widthScale: 0.98, attackScale: 0.82 },
    angry: { articulationScale: 1.03, jawScale: 1.08, widthScale: 1.01, attackScale: 1.14 },
    surprised: { articulationScale: 1, jawScale: 1.08, widthScale: 1, attackScale: 1.12 },
    calm: { articulationScale: 0.92, jawScale: 0.94, widthScale: 1, attackScale: 0.82 },
  },
} as const

export const speakingGestureTuning = {
  openingHoldMs: { min: 1500, max: 2500 },
  longReplySwitchMs: { min: 6000, max: 10000 },
  emphasisCooldownMs: 4000,
  maxHoldingSwitches: 1,
  blendDuration: 0.65,
  emotionalPeakBehaviors: ['happy', 'laugh', 'angry', 'surprised', 'gasp'] as const,
} as const
