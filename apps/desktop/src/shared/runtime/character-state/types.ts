export type CharacterRuntimeMode =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'awaitingSpeech'
  | 'speaking'
  | 'acting'
  | 'interrupted'
  | 'sleeping'

export type CharacterSpeechStatus =
  | 'silent'
  | 'listening'
  | 'recognizing'
  | 'generating'
  | 'synthesizing'
  | 'speaking'

export type CharacterSpeechState = CharacterSpeechStatus

export type CharacterActivityState =
  | 'idle'
  | 'waiting'
  | 'listening'
  | 'answering'
  | 'explaining'
  | 'greeting'
  | 'processing'
  | 'preparingSpeech'
  | 'speaking'
  | 'reacting'
  | 'error'

export type CharacterAttentionFocus =
  | 'none'
  | 'user'
  | 'speechService'
  | 'llm'
  | 'tts'
  | 'avatar'
  | 'environment'

export interface CharacterAttentionState {
  focus: CharacterAttentionFocus
  confidence: number
}

export interface CharacterSpeechRuntimeState {
  status: CharacterSpeechStatus
  voiceId: string
  isSpeaking: boolean
  ttsGeneration: 'idle' | 'requested' | 'generating' | 'ready' | 'failed'
  currentSentence: string
  playbackProgress: number
}

export interface CharacterAnimationState {
  behavior: string
  animationId: string
  queueLength: number
}

export interface CharacterVoiceState {
  voiceId: string
  dataset: string
}

export type CharacterPostureState = 'standing' | 'relaxed' | 'armsCrossed' | 'thinking'

export interface CharacterConversationState {
  replyType: string
  lastUserIntent: string
  conversationPhase: 'none' | 'input' | 'thinking' | 'replying' | 'complete'
}

export type ConversationPresencePhase =
  | 'waiting'
  | 'preparingReply'
  | 'thinking'
  | 'startingSpeech'
  | 'speaking'
  | 'finishingSpeech'
  | 'listening'

export type ConversationPresenceEngagement = 'low' | 'normal' | 'high'
export type ConversationPresenceReplyLength = 'veryShort' | 'short' | 'medium' | 'long' | 'veryLong'
export type ConversationPresenceHesitation = 'none' | 'brief' | 'thinking' | 'surprised'
export type ConversationPresenceEmphasis =
  | 'none'
  | 'explaining'
  | 'warning'
  | 'celebrating'
  | 'joking'
  | 'confused'
  | 'question'
  | 'agreement'
  | 'disagreement'
export type ConversationPresenceReaction =
  | 'none'
  | 'amused'
  | 'curious'
  | 'impressed'
  | 'concerned'
  | 'playful'
  | 'confident'
  | 'embarrassed'
export type ConversationPresencePauseHint =
  | 'none'
  | 'beforeSpeech'
  | 'beforeExplanation'
  | 'beforeEmotionalSentence'
  | 'beforeImportantStatement'

export interface CharacterConversationPresenceState {
  engagement: ConversationPresenceEngagement
  hesitation: ConversationPresenceHesitation
  emphasis: ConversationPresenceEmphasis
  reaction: ConversationPresenceReaction
  pauseHint: ConversationPresencePauseHint
  replyLength: ConversationPresenceReplyLength
  responsePhase: ConversationPresencePhase
  lastUpdate: number
}

export interface CharacterAvatarState {
  mode: CharacterRuntimeMode
  expression: string
  avatarExpression?: string
  lipsync: {
    aa: number
    ih: number
    ou: number
    ee: number
    oh: number
  }
  loaded: boolean
}

export interface CharacterState {
  mode: CharacterRuntimeMode
  emotion: string
  activity: CharacterActivityState
  attention: CharacterAttentionState
  speechState: CharacterSpeechRuntimeState
  animation: CharacterAnimationState
  voice: CharacterVoiceState
  posture: CharacterPostureState
  conversation: CharacterConversationState
  conversationPresence: CharacterConversationPresenceState
  avatar: CharacterAvatarState
  updatedAt: number
}
