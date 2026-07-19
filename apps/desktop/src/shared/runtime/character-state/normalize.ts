import type { CharacterState } from './types'

export function cloneCharacterState(state: CharacterState): CharacterState {
  return {
    ...state,
    attention: { ...state.attention },
    speechState: { ...state.speechState },
    animation: { ...state.animation },
    voice: { ...state.voice },
    conversation: { ...state.conversation },
    conversationPresence: { ...state.conversationPresence },
    avatar: {
      ...state.avatar,
      lipsync: { ...state.avatar.lipsync },
    },
  }
}

export function normalizeCharacterState(state: CharacterState): CharacterState {
  return {
    ...state,
    speechState: {
      ...state.speechState,
      isSpeaking: state.speechState.status === 'speaking',
    },
    avatar: {
      ...state.avatar,
      mode: state.mode,
    },
  }
}
