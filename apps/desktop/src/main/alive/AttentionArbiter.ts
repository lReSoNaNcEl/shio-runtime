import type {
  AttentionCandidate,
  AttentionDecision,
  AutonomySettings,
  FastBrainAttentionDecision,
  FastBrainAttentionInput,
} from '../../shared/alive'
import type { FastBrainRuntime } from './FastBrainRuntime'

const CLEAR_WINNER_MARGIN = 0.18

export class AttentionArbiter {
  constructor(private readonly fastBrain: FastBrainRuntime) {}

  async decide(
    candidates: readonly AttentionCandidate[],
    settings: AutonomySettings,
    options: { busy?: boolean; now?: number } = {},
  ): Promise<AttentionDecision> {
    const startedAt = Date.now()
    const now = options.now ?? startedAt
    const viable = candidates
      .filter(
        (candidate) =>
          candidate.interruptibility !== 'never' &&
          (candidate.expiresAt === undefined || candidate.expiresAt > now),
      )
      .map((candidate) => ({ candidate, score: score(candidate, options.busy === true) }))
      .filter((entry) => entry.score >= 0.2)
      .sort((left, right) => right.score - left.score)
    if (viable.length === 0)
      return decision('ignore', undefined, 0.9, 'no_viable_candidate', startedAt)
    const winner = viable[0]
    const fallback = decision(
      disposition(winner.score),
      winner.candidate.id,
      Math.max(0.55, Math.min(0.98, winner.score)),
      'deterministic_score',
      startedAt,
    )
    if (viable.length === 1) return fallback
    const margin = winner.score - viable[1].score
    if (margin >= CLEAR_WINNER_MARGIN || !settings.fastBrain.enabled || settings.privacyMode) {
      return {
        ...fallback,
        reason: margin >= CLEAR_WINNER_MARGIN ? 'clear_winner' : 'model_disabled',
      }
    }
    return this.fastBrain.arbitrate(
      viable.slice(0, 4).map((entry) => entry.candidate),
      settings,
      fallback,
    )
  }

  async evaluateLegacy(
    input: FastBrainAttentionInput,
    settings: AutonomySettings,
  ): Promise<FastBrainAttentionDecision> {
    const decision = await this.decide(
      [
        {
          id: input.utteranceId,
          source: 'speech',
          summary: 'Ambient speech candidate',
          salience: input.directAddress ? 0.95 : input.question ? 0.62 : 0.38,
          novelty: input.recentConversation ? 0.2 : 0.45,
          urgency: input.directAddress ? 0.8 : 0.2,
          socialRelevance: input.directAddress ? 1 : input.question ? 0.6 : 0.3,
          interruptibility: input.directAddress
            ? 'urgent'
            : input.speaking || input.cooldownActive
              ? 'when-idle'
              : 'normal',
          createdAt: Date.now(),
        },
      ],
      settings,
      { busy: input.speaking || input.cooldownActive },
    )
    return {
      shouldAttend: decision.disposition === 'admit',
      confidence: decision.confidence,
      source: decision.source,
      reason: decision.reason,
      latencyMs: decision.latencyMs,
    }
  }
}

function score(candidate: AttentionCandidate, busy: boolean): number {
  const base =
    candidate.salience * 0.32 +
    candidate.novelty * 0.16 +
    candidate.urgency * 0.3 +
    candidate.socialRelevance * 0.22
  const interruptibility =
    candidate.interruptibility === 'urgent'
      ? 0.15
      : candidate.interruptibility === 'when-idle' && busy
        ? -0.45
        : 0
  return Math.max(0, Math.min(1, base + interruptibility))
}

function disposition(scoreValue: number): AttentionDecision['disposition'] {
  if (scoreValue >= 0.55) return 'admit'
  return scoreValue >= 0.3 ? 'observe' : 'ignore'
}

function decision(
  dispositionValue: AttentionDecision['disposition'],
  candidateId: string | undefined,
  confidence: number,
  reason: string,
  startedAt: number,
): AttentionDecision {
  return {
    disposition: dispositionValue,
    ...(candidateId ? { candidateId } : {}),
    confidence,
    source: 'deterministic',
    reason,
    latencyMs: Date.now() - startedAt,
  }
}
