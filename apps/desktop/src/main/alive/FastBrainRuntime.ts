import type {
  AutonomySettings,
  FastBrainAttentionDecision,
  FastBrainAttentionInput,
} from '../../shared/alive'
import type { LlmGateway } from '../llm'
import { mainLog } from '../logging/safeLogger'

export class FastBrainRuntime {
  constructor(
    private readonly llm: (selection: {
      providerId?: AutonomySettings['fastBrain']['providerId']
      model?: string
    }) => LlmGateway,
  ) {}

  async evaluate(
    input: FastBrainAttentionInput,
    settings: AutonomySettings,
  ): Promise<FastBrainAttentionDecision> {
    const startedAt = Date.now()
    const fallback = deterministicAttention(input, startedAt)
    if (!settings.fastBrain.enabled || settings.privacyMode) {
      return { ...fallback, source: 'disabled' }
    }
    try {
      const response = await this.llm({
        providerId: settings.fastBrain.providerId,
        model: settings.fastBrain.model,
      }).chat(
        [
          {
            role: 'system',
            content:
              'Classify attention from boolean cues only. Return JSON: {"attend":boolean,"confidence":0..1,"reason":"short"}.',
          },
          { role: 'user', content: JSON.stringify(input) },
        ],
        {
          traceId: `fast-brain:${input.utteranceId}`,
          timeoutMs: settings.fastBrain.timeoutMs,
          maxTokens: settings.fastBrain.maxTokens,
        },
      )
      const parsed = JSON.parse(response.match(/\{[\s\S]*\}/u)?.[0] ?? '') as {
        attend?: unknown
        confidence?: unknown
        reason?: unknown
      }
      if (typeof parsed.attend !== 'boolean') return { ...fallback, source: 'fallback' }
      return {
        shouldAttend: parsed.attend,
        confidence:
          typeof parsed.confidence === 'number'
            ? Math.max(0, Math.min(1, parsed.confidence))
            : fallback.confidence,
        source: 'model',
        reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 120) : 'model',
        latencyMs: Date.now() - startedAt,
      }
    } catch (error) {
      mainLog.warn('[FastBrain] attention fallback', {
        code: error instanceof Error ? error.name : 'UNKNOWN',
      })
      return { ...fallback, source: 'fallback', latencyMs: Date.now() - startedAt }
    }
  }
}

function deterministicAttention(
  input: FastBrainAttentionInput,
  startedAt: number,
): FastBrainAttentionDecision {
  const score =
    (input.directAddress ? 0.65 : 0) +
    (input.question ? 0.2 : 0) +
    (input.recentConversation ? 0.2 : 0) -
    (input.cooldownActive && !input.directAddress ? 0.25 : 0) -
    (input.speaking && !input.directAddress ? 0.25 : 0)
  return {
    shouldAttend: score >= 0.45,
    confidence: Math.max(0.5, Math.min(0.95, Math.abs(score - 0.45) + 0.5)),
    source: 'deterministic',
    reason: 'bounded_boolean_cues',
    latencyMs: Date.now() - startedAt,
  }
}
