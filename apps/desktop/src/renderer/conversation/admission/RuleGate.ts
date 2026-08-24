import type {
  AttentionDecision,
  RuleGateDecision,
  UtteranceChunk,
} from '../../speech/continuous-listening/types'

export interface RuleGateContext {
  isSpeaking: boolean
  conversationBusy: boolean
  cooldownActive: boolean
  alreadyHandled: boolean
}

export class RuleGate {
  decide(
    chunk: UtteranceChunk,
    attention: AttentionDecision,
    context: RuleGateContext,
  ): RuleGateDecision {
    if (!chunk.text.trim()) return { type: 'ignore', reason: 'invalid_text' }
    if (context.alreadyHandled) return { type: 'ignore', reason: 'duplicate_chunk' }
    if (!attention.shouldAttend) return { type: 'ignore', reason: attention.reasons.join(',') }
    if ((context.isSpeaking || context.conversationBusy) && attention.directAddress) {
      return { type: 'backlog', userText: chunk.text, reason: 'direct_address_while_busy' }
    }
    if (context.isSpeaking || context.conversationBusy) {
      return { type: 'backlog', userText: chunk.text, reason: 'attended_utterance_while_busy' }
    }
    if (context.cooldownActive && !attention.directAddress)
      return { type: 'ignore', reason: 'reply_cooldown' }
    return {
      type: 'llm',
      userText: chunk.text,
      reason: attention.directAddress ? 'direct_address' : 'attended_utterance',
    }
  }
}
