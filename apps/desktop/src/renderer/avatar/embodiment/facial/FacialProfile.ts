import type { BlinkControllerOptions } from './BlinkController'
import type { FacialEasingId } from './facialEasing'

export type VisemeName = 'aa' | 'ih' | 'ou' | 'ee' | 'oh'
export type MouthWeights = Record<VisemeName, number>

export interface FacialProfile {
  id: string
  expressionWeights: Record<string, number>
  visemeBias: Partial<MouthWeights>
  visemeScale: Partial<MouthWeights>
  blinkProfile: BlinkControllerOptions & { profileId: string }
  eyeProfile: {
    eyeContactBias: number
    eyeOpenness: number
    lookAwayBias: number
    /** Bounded bilateral blink depth variation, applied only with independent eyelids. */
    blinkAsymmetry: number
  }
  mouthProfile: {
    gainScale: number
    opennessScale: number
    softness: number
    closedMouthBias: number
    releaseScale: number
  }
  expressionMotion: {
    breathAmplitude: number
    breathSpeed: number
    speakingBoost: number
  }
  releaseProfile: {
    attackPerSecond: number
    holdMs: number
    releaseDurationMs: number
    curve: FacialEasingId
  }
}

const blink = (
  options: BlinkControllerOptions & { profileId: string },
): BlinkControllerOptions & { profileId: string } => options

const baseBlink = {
  profileId: 'neutral',
  intervalMin: 3.4,
  intervalMax: 5.2,
  durationMs: 410,
  doubleBlinkChance: 0.04,
  weightMin: 0.42,
  weightMax: 0.64,
  blinkMax: 0.66,
  cooldownMs: 680,
} as const

const release = (
  releaseDurationMs: number,
  attackPerSecond = 6,
  holdMs = 0,
): FacialProfile['releaseProfile'] => ({
  attackPerSecond,
  holdMs,
  releaseDurationMs,
  curve: 'easeInOutCubic',
})

const eye = (
  eyeContactBias: number,
  lookAwayBias = 0.08,
  eyeOpenness = 1,
  blinkAsymmetry = 0,
): FacialProfile['eyeProfile'] => ({
  eyeContactBias,
  eyeOpenness,
  lookAwayBias,
  blinkAsymmetry,
})

const mouth = (
  gainScale: number,
  opennessScale: number,
  closedMouthBias: number,
  softness = 1,
  releaseScale = 1,
): FacialProfile['mouthProfile'] => ({
  gainScale,
  opennessScale,
  softness,
  closedMouthBias,
  releaseScale,
})

const expressionMotion = (
  breathAmplitude: number,
  breathSpeed = 0.32,
  speakingBoost = 1,
): FacialProfile['expressionMotion'] => ({
  breathAmplitude,
  breathSpeed,
  speakingBoost,
})

export const FACIAL_PROFILES = {
  neutral: {
    id: 'neutral',
    expressionWeights: {},
    visemeBias: {},
    visemeScale: { aa: 0.92, ih: 0.9, ou: 0.92, ee: 0.9, oh: 0.92 },
    blinkProfile: blink({ ...baseBlink }),
    eyeProfile: eye(0.72),
    mouthProfile: mouth(1, 0.92, 0.04),
    expressionMotion: expressionMotion(0.012, 0.28, 0.7),
    releaseProfile: release(620, 6, 450),
  },
  happy: {
    id: 'happy',
    expressionWeights: { happy: 0.54, relaxed: 0.14, surprised: 0.02 },
    visemeBias: { ee: 0.01 },
    visemeScale: { aa: 0.96, ih: 0.94, ou: 0.88, ee: 0.96, oh: 0.88 },
    blinkProfile: blink({
      ...baseBlink,
      profileId: 'happy',
      intervalMin: 2.4,
      intervalMax: 4.0,
      durationMs: 340,
      doubleBlinkChance: 0.08,
      weightMin: 0.34,
      weightMax: 0.54,
      blinkMax: 0.56,
    }),
    eyeProfile: eye(0.86, 0.04, 1.04),
    mouthProfile: mouth(1.02, 0.96, 0.04, 0.94),
    expressionMotion: expressionMotion(0.036, 0.24, 1),
    releaseProfile: release(860, 6.5, 2400),
  },
  laugh: {
    id: 'laugh',
    expressionWeights: { happy: 0.64, relaxed: 0.12, surprised: 0.04 },
    visemeBias: { aa: 0.04, ee: 0.015 },
    visemeScale: { aa: 1.04, ih: 0.96, ou: 0.9, ee: 1, oh: 0.94 },
    blinkProfile: blink({
      ...baseBlink,
      profileId: 'laugh',
      intervalMin: 2.2,
      intervalMax: 3.6,
      durationMs: 320,
      doubleBlinkChance: 0.09,
      weightMin: 0.32,
      weightMax: 0.52,
      blinkMax: 0.54,
    }),
    eyeProfile: eye(0.82, 0.08, 1.06, 0.08),
    mouthProfile: mouth(1.06, 1.0, 0.035, 0.9),
    expressionMotion: expressionMotion(0.042, 0.3, 1.08),
    releaseProfile: release(920, 7, 1800),
  },
  chuckle: {
    id: 'chuckle',
    expressionWeights: { happy: 0.42, relaxed: 0.18, surprised: 0.015 },
    visemeBias: { aa: 0.02 },
    visemeScale: { aa: 0.98, ih: 0.94, ou: 0.88, ee: 0.96, oh: 0.88 },
    blinkProfile: blink({
      ...baseBlink,
      profileId: 'chuckle',
      intervalMin: 2.6,
      intervalMax: 4.2,
      weightMin: 0.36,
      weightMax: 0.56,
      blinkMax: 0.58,
    }),
    eyeProfile: eye(0.8, 0.07, 1.02, 0.05),
    mouthProfile: mouth(1, 0.94, 0.04, 0.94),
    expressionMotion: expressionMotion(0.028, 0.28, 1),
    releaseProfile: release(780, 6.4, 1600),
  },
  embarrassed: {
    id: 'embarrassed',
    expressionWeights: { happy: 0.1, sad: 0.05, relaxed: 0.12 },
    visemeBias: { ih: 0.01 },
    visemeScale: { aa: 0.82, ih: 0.86, ou: 0.84, ee: 0.85, oh: 0.82 },
    blinkProfile: blink({
      ...baseBlink,
      profileId: 'embarrassed',
      intervalMin: 1.7,
      intervalMax: 2.8,
      durationMs: 330,
      doubleBlinkChance: 0.14,
      weightMin: 0.42,
      weightMax: 0.66,
      blinkMax: 0.68,
    }),
    eyeProfile: eye(0.48, 0.32, 0.94, 0.12),
    mouthProfile: mouth(0.86, 0.82, 0.055, 1.12, 1.08),
    expressionMotion: expressionMotion(0.032, 0.38, 1.12),
    releaseProfile: release(900, 5.4, 1200),
  },
  thinking: {
    id: 'thinking',
    expressionWeights: { relaxed: 0.4, sad: 0.04 },
    visemeBias: {},
    visemeScale: { aa: 0.86, ih: 0.86, ou: 0.88, ee: 0.85, oh: 0.88 },
    blinkProfile: blink({
      ...baseBlink,
      profileId: 'thinking',
      intervalMin: 4.4,
      intervalMax: 7.2,
      durationMs: 520,
      weightMin: 0.42,
      weightMax: 0.62,
      blinkMax: 0.64,
    }),
    eyeProfile: eye(0.36, 0.28, 0.98),
    mouthProfile: mouth(0.92, 0.86, 0.05, 1.06, 1.06),
    expressionMotion: expressionMotion(0.01, 0.18, 0.45),
    releaseProfile: release(820, 5.5, 900),
  },
  angry: {
    id: 'angry',
    expressionWeights: { angry: 0.72, sad: 0.08 },
    visemeBias: { aa: 0.03, oh: 0.02 },
    visemeScale: { aa: 1.08, ih: 0.96, ou: 1.02, ee: 0.94, oh: 1.04 },
    blinkProfile: blink({
      ...baseBlink,
      profileId: 'angry',
      intervalMin: 3.2,
      intervalMax: 5.2,
      durationMs: 350,
      weightMin: 0.34,
      weightMax: 0.54,
      blinkMax: 0.58,
    }),
    eyeProfile: eye(0.84, 0.04, 0.96),
    mouthProfile: mouth(1.06, 1.04, 0.03, 0.88),
    expressionMotion: expressionMotion(0.02, 0.32, 0.8),
    releaseProfile: release(760, 6.8, 1200),
  },
  sad: {
    id: 'sad',
    expressionWeights: { sad: 0.68, relaxed: 0.08 },
    visemeBias: {},
    visemeScale: { aa: 0.84, ih: 0.84, ou: 0.88, ee: 0.82, oh: 0.88 },
    blinkProfile: blink({
      ...baseBlink,
      profileId: 'sad',
      intervalMin: 3.8,
      intervalMax: 6.2,
      durationMs: 470,
      weightMin: 0.46,
      weightMax: 0.68,
      blinkMax: 0.7,
    }),
    eyeProfile: eye(0.58, 0.18, 0.94),
    mouthProfile: mouth(0.88, 0.84, 0.052, 1.08, 1.08),
    expressionMotion: expressionMotion(0.016, 0.2, 0.6),
    releaseProfile: release(900, 5.2, 1500),
  },
  surprised: {
    id: 'surprised',
    expressionWeights: { surprised: 0.48, relaxed: 0.06 },
    visemeBias: { aa: 0.025, oh: 0.03 },
    visemeScale: { aa: 1, ih: 0.9, ou: 0.98, ee: 0.9, oh: 1.02 },
    blinkProfile: blink({
      ...baseBlink,
      profileId: 'surprised',
      intervalMin: 2.2,
      intervalMax: 3.8,
      durationMs: 310,
      weightMin: 0.28,
      weightMax: 0.46,
      blinkMax: 0.52,
    }),
    eyeProfile: eye(0.9, 0.06, 1.08),
    mouthProfile: mouth(1.04, 1.0, 0.035, 0.9),
    expressionMotion: expressionMotion(0.026, 0.34, 0.86),
    releaseProfile: release(720, 7, 900),
  },
  approval: {
    id: 'approval',
    expressionWeights: { happy: 0.34, relaxed: 0.24 },
    visemeBias: { ee: 0.01 },
    visemeScale: { aa: 0.92, ih: 0.92, ou: 0.88, ee: 0.94, oh: 0.88 },
    blinkProfile: blink({
      ...baseBlink,
      profileId: 'approval',
      intervalMin: 3.0,
      intervalMax: 4.8,
      weightMin: 0.38,
      weightMax: 0.58,
      blinkMax: 0.6,
    }),
    eyeProfile: eye(0.84, 0.05, 1.02),
    mouthProfile: mouth(0.96, 0.9, 0.044, 0.98),
    expressionMotion: expressionMotion(0.02, 0.2, 0.72),
    releaseProfile: release(780, 6.2, 1900),
  },
  confusion: {
    id: 'confusion',
    expressionWeights: { surprised: 0.18, sad: 0.06, relaxed: 0.12 },
    visemeBias: { ih: 0.01 },
    visemeScale: { aa: 0.86, ih: 0.94, ou: 0.86, ee: 0.92, oh: 0.88 },
    blinkProfile: blink({
      ...baseBlink,
      profileId: 'confusion',
      intervalMin: 3.6,
      intervalMax: 5.8,
      durationMs: 430,
      weightMin: 0.4,
      weightMax: 0.62,
      blinkMax: 0.64,
    }),
    eyeProfile: eye(0.46, 0.24, 1),
    mouthProfile: mouth(0.9, 0.86, 0.052, 1.1),
    expressionMotion: expressionMotion(0.018, 0.22, 0.62),
    releaseProfile: release(820, 5.8, 1200),
  },
} as const satisfies Record<string, FacialProfile>

export type FacialProfileId = keyof typeof FACIAL_PROFILES

export const DEFAULT_FACIAL_PROFILE_ID: FacialProfileId = 'neutral'

const PROFILE_ALIASES: Record<string, FacialProfileId> = {
  shy: 'embarrassed',
  amused: 'chuckle',
  sleepy: 'neutral',
  excited: 'happy',
  worried: 'sad',
  confused: 'confusion',
  proud: 'approval',
  pouting: 'angry',
  loving: 'approval',
  dazed: 'confusion',
  calm: 'neutral',
  warm: 'approval',
  crying: 'sad',
  fear: 'confusion',
  gasp: 'surprised',
  sigh: 'thinking',
  groan: 'angry',
  whisper: 'thinking',
  relaxed: 'neutral',
}

export function resolveFacialProfileId(key?: string): FacialProfileId {
  const normalized = (key ?? DEFAULT_FACIAL_PROFILE_ID).trim().toLowerCase()
  if (normalized in FACIAL_PROFILES) return normalized as FacialProfileId
  return PROFILE_ALIASES[normalized] ?? DEFAULT_FACIAL_PROFILE_ID
}

export function getFacialProfile(key?: string): FacialProfile {
  return FACIAL_PROFILES[resolveFacialProfileId(key)]
}

export function createZeroMouthWeights(): MouthWeights {
  return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }
}

export function completeMouthWeights(weights: Partial<MouthWeights>): MouthWeights {
  return {
    aa: weights.aa ?? 0,
    ih: weights.ih ?? 0,
    ou: weights.ou ?? 0,
    ee: weights.ee ?? 0,
    oh: weights.oh ?? 0,
  }
}

export const VISEME_NAMES: readonly VisemeName[] = ['aa', 'ih', 'ou', 'ee', 'oh']
