import { emotionRegistry } from '../../shared/emotion'
import type { AvatarBehaviorId } from './AvatarBehaviorResolver'

export type AvatarMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'awaitingSpeech'

export interface AvatarStateEffect {
  mode: AvatarMode
  proceduralMode: 'idle' | 'listening' | 'thinking' | 'speaking'
  emotionKey: string
  behaviorId: AvatarBehaviorId
  loop: boolean
  resetMouth?: boolean
  attachLipSync?: boolean
  detachLipSync?: boolean
}

const MODE_EFFECTS: Record<
  Exclude<AvatarMode, 'speaking' | 'awaitingSpeech'>,
  Omit<AvatarStateEffect, 'mode'>
> = {
  idle: {
    proceduralMode: 'idle',
    emotionKey: 'neutral',
    behaviorId: 'idle',
    loop: true,
    detachLipSync: true,
  },
  listening: {
    proceduralMode: 'listening',
    emotionKey: 'calm',
    behaviorId: 'listening',
    loop: true,
  },
  thinking: {
    proceduralMode: 'thinking',
    emotionKey: 'calm',
    behaviorId: 'thinking',
    loop: true,
  },
}

export class AvatarStateMachine {
  private mode: AvatarMode = 'idle'
  private emotionKey = 'neutral'

  getMode(): AvatarMode {
    return this.mode
  }

  getEmotion(): string {
    return this.emotionKey
  }

  getIdleEffect(): AvatarStateEffect {
    return { mode: 'idle', ...MODE_EFFECTS.idle }
  }

  setMode(mode: AvatarMode): AvatarStateEffect {
    this.mode = mode

    if (mode === 'awaitingSpeech') {
      return {
        mode,
        proceduralMode: 'thinking',
        emotionKey: this.emotionKey,
        behaviorId: 'thinking',
        loop: true,
        resetMouth: true,
      }
    }

    if (mode === 'speaking') {
      return {
        mode,
        proceduralMode: 'speaking',
        emotionKey: this.emotionKey,
        behaviorId: this.toBehaviorId(this.emotionKey),
        loop: true,
        attachLipSync: true,
      }
    }

    const effect = MODE_EFFECTS[mode]
    this.emotionKey = effect.emotionKey
    return { mode, ...effect }
  }

  setEmotion(emotionKey?: string): AvatarStateEffect | null {
    this.emotionKey = emotionKey || 'neutral'
    if (this.mode !== 'speaking') return null

    return {
      mode: this.mode,
      proceduralMode: 'speaking',
      emotionKey: this.emotionKey,
      behaviorId: this.toBehaviorId(this.emotionKey),
      loop: true,
      attachLipSync: true,
    }
  }

  prepareSpeaking(emotionKey?: string): AvatarStateEffect {
    this.mode = 'awaitingSpeech'
    this.emotionKey = emotionKey || this.emotionKey || 'neutral'
    return {
      mode: this.mode,
      proceduralMode: 'thinking',
      emotionKey: this.emotionKey,
      behaviorId: 'thinking',
      loop: true,
      resetMouth: true,
    }
  }

  startSpeaking(emotionKey?: string): AvatarStateEffect {
    this.mode = 'speaking'
    this.emotionKey = emotionKey || this.emotionKey || 'neutral'
    return {
      mode: this.mode,
      proceduralMode: 'speaking',
      emotionKey: this.emotionKey,
      behaviorId: this.toBehaviorId(this.emotionKey),
      loop: true,
      attachLipSync: true,
    }
  }

  stopSpeaking(): AvatarStateEffect {
    this.mode = 'idle'
    this.emotionKey = MODE_EFFECTS.idle.emotionKey
    return { mode: 'idle', ...MODE_EFFECTS.idle }
  }

  previewGreeting(): AvatarStateEffect {
    this.mode = 'speaking'
    this.emotionKey = 'happy'
    return {
      mode: this.mode,
      proceduralMode: 'speaking',
      emotionKey: this.emotionKey,
      behaviorId: 'greeting',
      loop: false,
    }
  }

  private toBehaviorId(emotionKey: string): AvatarBehaviorId {
    return emotionRegistry.avatarBehavior(emotionKey) as AvatarBehaviorId
  }
}
