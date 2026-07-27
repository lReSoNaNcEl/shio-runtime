import type { ContinuousListeningSettings } from './types'

export const chunkBuilderTuning = {
  pauseCompletionMs: 900,
  hardTimeoutMs: 12_000,
  maxCharacters: 500,
  minimumCharacters: 2,
} as const

export const attentionTuning = {
  threshold: 28,
  score: {
    directNameMention: 80,
    question: 18,
    recentConversation: 20,
    followUpWindow: 15,
    secondPersonAddress: 30,
    defaultPolicyRelevance: 12,
    emotionalExpression: 12,
    likelySelfTalk: -35,
    tooShort: -45,
    replyCooldown: -60,
    speakingNonDirect: -15,
  },
} as const

export const defaultContinuousListeningSettings: ContinuousListeningSettings = {
  enabled: false,
  replyCooldownMs: 15_000,
  followUpWindowMs: 20_000,
  curiosityChance: 0.03,
}

export const bargeInTuning = {
  enabled: true,
  minimumSpeechMs: 320,
  playbackGraceMs: 250,
  minimumConfidence: 0.45,
  minimumTextLength: 2,
  retriggerCooldownMs: 1_000,
  selfEchoSimilarityThreshold: 0.68,
} as const

export const backlogTuning = {
  maxItems: 10,
  ttlMs: { correction: 30_000, direct: 25_000, followUp: 18_000, nonDirect: 8_000 },
  maxSelectedTurnsPerDrain: 1,
  mergeWindowMs: 6_000,
  maxMergedCharacters: 600,
  recentIdLimit: 128,
} as const

export function parseTunedNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value)
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback))
}
