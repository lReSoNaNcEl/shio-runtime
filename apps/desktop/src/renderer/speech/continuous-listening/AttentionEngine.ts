import { attentionTuning } from './tuning'
import type { AttentionDecision, UtteranceChunk } from './types'

export interface AttentionContext {
  isSpeaking: boolean
  cooldownActive: boolean
  recentConversation: boolean
  followUpWindow: boolean
  rng?: () => number
  curiosityChance: number
}

const NAME_PATTERN = /(?:^|[^\p{L}\p{N}_])(?:shio|шио)(?=$|[^\p{L}\p{N}_])/iu
const SECOND_PERSON_PATTERN =
  /(?:^|[^\p{L}\p{N}_])(?:ты|тебя|тебе|твой|твоя|твоё|твои)(?=$|[^\p{L}\p{N}_])/iu
const QUESTION_PATTERN =
  /\?|(?:^|[^\p{L}\p{N}_])(?:кто|что|где|когда|зачем|почему|как|можешь|скажешь|думаешь)(?=$|[^\p{L}\p{N}_])/iu
const EMOTIONAL_PATTERN =
  /!{1,}|(?:^|[^\p{L}\p{N}_])(?:ужасн[\p{L}\p{M}]*|крут[\p{L}\p{M}]*|кошмар[\p{L}\p{M}]*|бесит|обожаю|ненавижу)(?=$|[^\p{L}\p{N}_])/iu

export class AttentionEngine {
  evaluate(chunk: UtteranceChunk, context: AttentionContext): AttentionDecision {
    const text = chunk.text.trim()
    const directAddress = NAME_PATTERN.test(text)
    const question = QUESTION_PATTERN.test(text)
    const secondPerson = SECOND_PERSON_PATTERN.test(text)
    const emotional = EMOTIONAL_PATTERN.test(text)
    const reasons: string[] = []
    let score = 0
    const add = (value: number, reason: string): void => {
      score += value
      reasons.push(`${reason}:${value >= 0 ? '+' : ''}${value}`)
    }

    if (directAddress) add(attentionTuning.score.directNameMention, 'direct_name')
    if (question) add(attentionTuning.score.question, 'question')
    if (secondPerson) add(attentionTuning.score.secondPersonAddress, 'second_person')
    if (context.recentConversation)
      add(attentionTuning.score.recentConversation, 'recent_conversation')
    if (context.followUpWindow) add(attentionTuning.score.followUpWindow, 'follow_up')
    if (emotional || question)
      add(attentionTuning.score.defaultPolicyRelevance, 'default_policy_relevance')
    if (emotional) add(attentionTuning.score.emotionalExpression, 'emotional_expression')
    if (text.length < 4) add(attentionTuning.score.tooShort, 'too_short')
    if (context.cooldownActive && !directAddress)
      add(attentionTuning.score.replyCooldown, 'reply_cooldown')
    if (context.isSpeaking && !directAddress)
      add(attentionTuning.score.speakingNonDirect, 'speaking_non_direct')

    const threshold = attentionTuning.threshold
    let shouldAttend = score >= threshold
    if (!shouldAttend && !context.cooldownActive) {
      const curiosityHit = (context.rng ?? Math.random)() < context.curiosityChance
      if (curiosityHit) {
        score = Math.max(score, threshold)
        reasons.push('curiosity:accepted')
        shouldAttend = true
      }
    }
    if (reasons.length === 0) reasons.push('no_attention_signal')
    return { shouldAttend, score, threshold, reasons, directAddress }
  }
}
