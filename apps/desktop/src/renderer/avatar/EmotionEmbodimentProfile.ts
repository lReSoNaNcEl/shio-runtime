export type CanonicalEmbodimentEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'calm'

export interface EmotionEmbodimentProfile {
  id: CanonicalEmbodimentEmotion
  facialKey: string
  lipSyncProfile: CanonicalEmbodimentEmotion
  ear: {
    lift: number
    spread: number
    amplitudeScale: number
  }
  head: {
    energyScale: number
    nodBias: number
    tiltBias: number
  }
  animationTags: string[]
}

const PROFILES: Record<CanonicalEmbodimentEmotion, EmotionEmbodimentProfile> = {
  neutral: {
    id: 'neutral',
    facialKey: 'neutral',
    lipSyncProfile: 'neutral',
    ear: { lift: 0, spread: 0, amplitudeScale: 1 },
    head: { energyScale: 1, nodBias: 1, tiltBias: 1 },
    animationTags: ['behavior:neutral'],
  },
  happy: {
    id: 'happy',
    facialKey: 'happy',
    lipSyncProfile: 'happy',
    ear: { lift: 0.35, spread: 0.15, amplitudeScale: 1.15 },
    head: { energyScale: 1.12, nodBias: 1.08, tiltBias: 1.02 },
    animationTags: ['behavior:happy', 'behavior:warm'],
  },
  sad: {
    id: 'sad',
    facialKey: 'sad',
    lipSyncProfile: 'sad',
    ear: { lift: -0.45, spread: -0.12, amplitudeScale: 0.85 },
    head: { energyScale: 0.78, nodBias: 0.72, tiltBias: 0.9 },
    animationTags: ['behavior:sad', 'behavior:crying'],
  },
  angry: {
    id: 'angry',
    facialKey: 'angry',
    lipSyncProfile: 'angry',
    ear: { lift: -0.6, spread: -0.1, amplitudeScale: 0.95 },
    head: { energyScale: 1.08, nodBias: 1.12, tiltBias: 0.82 },
    animationTags: ['behavior:angry'],
  },
  surprised: {
    id: 'surprised',
    facialKey: 'surprised',
    lipSyncProfile: 'surprised',
    ear: { lift: 0.2, spread: 0.05, amplitudeScale: 1.2 },
    head: { energyScale: 1.08, nodBias: 0.9, tiltBias: 1.08 },
    animationTags: ['behavior:surprised', 'behavior:gasp'],
  },
  calm: {
    id: 'calm',
    facialKey: 'relaxed',
    lipSyncProfile: 'calm',
    ear: { lift: 0.08, spread: 0.04, amplitudeScale: 0.92 },
    head: { energyScale: 0.86, nodBias: 0.84, tiltBias: 0.92 },
    animationTags: ['behavior:calm', 'behavior:neutral', 'behavior:whisper'],
  },
}

const ALIASES: Record<string, CanonicalEmbodimentEmotion> = {
  joy: 'happy',
  cheerful: 'happy',
  happy: 'happy',
  laugh: 'happy',
  chuckle: 'happy',
  sadness: 'sad',
  apologetic: 'sad',
  sad: 'sad',
  crying: 'sad',
  anger: 'angry',
  annoyed: 'angry',
  angry: 'angry',
  surprise: 'surprised',
  surprised: 'surprised',
  gasp: 'surprised',
  calm: 'calm',
  relaxed: 'calm',
  whisper: 'calm',
  sigh: 'calm',
  groan: 'calm',
}

export function resolveEmotionEmbodimentProfile(emotionKey: string): EmotionEmbodimentProfile {
  const id = ALIASES[emotionKey.trim().toLowerCase()] ?? 'neutral'
  const profile = PROFILES[id]
  return {
    ...profile,
    ear: { ...profile.ear },
    head: { ...profile.head },
    animationTags: [...profile.animationTags],
  }
}
