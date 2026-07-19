import { emotionRegistry } from '../../emotion'
import type { CharacterState } from './types'

export const DEFAULT_CHARACTER_VOICE_ID = 'animevox_makima'

export const INITIAL_CHARACTER_STATE: CharacterState = {
  mode: 'idle',
  emotion: emotionRegistry.defaultEmotion,
  activity: 'waiting',
  attention: { focus: 'none', confidence: 0 },
  speechState: {
    status: 'silent',
    voiceId: DEFAULT_CHARACTER_VOICE_ID,
    isSpeaking: false,
    ttsGeneration: 'idle',
    currentSentence: '',
    playbackProgress: 0,
  },
  animation: {
    behavior: 'idle',
    animationId: 'none',
    queueLength: 0,
  },
  voice: {
    voiceId: DEFAULT_CHARACTER_VOICE_ID,
    dataset: 'AnimeVox',
  },
  posture: 'relaxed',
  conversation: {
    replyType: 'none',
    lastUserIntent: 'none',
    conversationPhase: 'none',
  },
  conversationPresence: {
    engagement: 'normal',
    hesitation: 'none',
    emphasis: 'none',
    reaction: 'none',
    pauseHint: 'none',
    replyLength: 'veryShort',
    responsePhase: 'waiting',
    lastUpdate: 0,
  },
  avatar: {
    mode: 'idle',
    expression: emotionRegistry.defaultEmotion,
    lipsync: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 },
    loaded: false,
  },
  updatedAt: 0,
}
