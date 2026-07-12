import type {
  CharacterConversationPresenceState,
  ConversationPresenceEmphasis,
  ConversationPresenceEngagement,
  ConversationPresenceHesitation,
  ConversationPresencePauseHint,
  ConversationPresencePhase,
  ConversationPresenceReaction,
  ConversationPresenceReplyLength
} from '../../shared/runtime/characterState'

export interface ConversationPresenceInput {
  phase: ConversationPresencePhase
  userText?: string
  replyText?: string
  emotionKey?: string
}

export class ConversationPresenceRuntime {
  private state: CharacterConversationPresenceState = {
    engagement: 'normal',
    hesitation: 'none',
    emphasis: 'none',
    reaction: 'none',
    pauseHint: 'none',
    replyLength: 'veryShort',
    responsePhase: 'waiting',
    lastUpdate: 0
  }

  update(input: ConversationPresenceInput): CharacterConversationPresenceState {
    const replyText = input.replyText ?? ''
    const userText = input.userText ?? ''
    const replyLength = this.classifyReplyLength(replyText)
    const emphasis = this.classifyEmphasis(replyText, input.emotionKey)
    const reaction = this.classifyReaction(replyText, userText, input.emotionKey)
    const next: CharacterConversationPresenceState = {
      engagement: this.classifyEngagement(replyLength, input.phase, userText),
      hesitation: this.classifyHesitation(input.phase, replyText, input.emotionKey),
      emphasis,
      reaction,
      pauseHint: this.classifyPauseHint(input.phase, emphasis, reaction),
      replyLength,
      responsePhase: input.phase,
      lastUpdate: Date.now()
    }
    this.state = next
    return { ...next }
  }

  getState(): CharacterConversationPresenceState {
    return { ...this.state }
  }

  private classifyReplyLength(text: string): ConversationPresenceReplyLength {
    const words = this.words(text)
    if (words <= 4) return 'veryShort'
    if (words <= 14) return 'short'
    if (words <= 38) return 'medium'
    if (words <= 85) return 'long'
    return 'veryLong'
  }

  private classifyEngagement(
    replyLength: ConversationPresenceReplyLength,
    phase: ConversationPresencePhase,
    userText: string
  ): ConversationPresenceEngagement {
    if (phase === 'listening' || phase === 'speaking') return 'high'
    if (replyLength === 'long' || replyLength === 'veryLong') return 'high'
    if (this.words(userText) <= 2 && phase === 'waiting') return 'low'
    return 'normal'
  }

  private classifyHesitation(
    phase: ConversationPresencePhase,
    text: string,
    emotionKey?: string
  ): ConversationPresenceHesitation {
    if (phase !== 'startingSpeech' && phase !== 'preparingReply' && phase !== 'thinking') return 'none'
    if (emotionKey === 'surprised' || emotionKey === 'gasp') return 'surprised'
    if (text.includes('?') || emotionKey === 'fear') return 'thinking'
    if (this.words(text) > 35) return 'brief'
    return phase === 'thinking' ? 'thinking' : 'brief'
  }

  private classifyEmphasis(text: string, emotionKey?: string): ConversationPresenceEmphasis {
    const lower = text.toLowerCase()
    if (text.trim().endsWith('?')) return 'question'
    if (emotionKey === 'happy' || emotionKey === 'laugh' || emotionKey === 'chuckle') return 'joking'
    if (emotionKey === 'surprised' || emotionKey === 'gasp') return 'confused'
    if (emotionKey === 'angry' || lower.includes('важно') || lower.includes('опас')) return 'warning'
    if (lower.includes('потому') || lower.includes('например') || lower.includes('значит')) return 'explaining'
    if (lower.includes('соглас') || lower.includes('верно') || lower.includes('точно')) return 'agreement'
    if (lower.includes('не соглас') || lower.includes('наоборот')) return 'disagreement'
    if (lower.includes('отлично') || lower.includes('круто') || lower.includes('ура')) return 'celebrating'
    return 'none'
  }

  private classifyReaction(text: string, userText: string, emotionKey?: string): ConversationPresenceReaction {
    const lower = `${text} ${userText}`.toLowerCase()
    if (emotionKey === 'laugh' || emotionKey === 'chuckle' || lower.includes('ха')) return 'amused'
    if (emotionKey === 'warm' || emotionKey === 'happy') return 'playful'
    if (emotionKey === 'sad' || emotionKey === 'crying' || lower.includes('проблем')) return 'concerned'
    if (emotionKey === 'surprised' || emotionKey === 'gasp') return 'impressed'
    if (lower.includes('?')) return 'curious'
    if (lower.includes('можно') || lower.includes('давай')) return 'confident'
    if (emotionKey === 'sigh') return 'embarrassed'
    return 'none'
  }

  private classifyPauseHint(
    phase: ConversationPresencePhase,
    emphasis: ConversationPresenceEmphasis,
    reaction: ConversationPresenceReaction
  ): ConversationPresencePauseHint {
    if (phase === 'startingSpeech') return 'beforeSpeech'
    if (emphasis === 'explaining') return 'beforeExplanation'
    if (reaction === 'concerned' || reaction === 'impressed') return 'beforeEmotionalSentence'
    if (emphasis === 'warning' || emphasis === 'disagreement') return 'beforeImportantStatement'
    return 'none'
  }

  private words(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length
  }
}
