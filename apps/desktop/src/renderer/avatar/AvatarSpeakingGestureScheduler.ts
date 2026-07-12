import type { CharacterState } from '../../shared/runtime/characterState'
import { speakingGestureTuning } from '../three/avatarTuning'
import type { AvatarBehaviorId } from './AvatarBehaviorResolver'
import type { AvatarStateEffect } from './AvatarStateMachine'

export type SpeakingGesturePhase = 'idle' | 'beginning' | 'middle' | 'emotional-peak' | 'ending'

export interface SpeakingGestureDecision {
  shouldRequest: boolean
  behaviorId: AvatarBehaviorId
  phase: SpeakingGesturePhase
  reason: string
}

export interface SpeakingGestureSchedulerDebugState {
  active: boolean
  sessionId: number
  elapsedMs: number
  phase: SpeakingGesturePhase
  currentGesture: string
  nextGestureInMs: number
  lastScheduledAnimation: string
  nextBehavior: string
  skippedCandidates: string[]
  selectionReason: string
  schedulerDecision: string
}

export class AvatarSpeakingGestureScheduler {
  private active = false
  private sessionId = 0
  private elapsedMs = 0
  private nextGestureInMs = 0
  private currentGesture = 'none'
  private lastScheduledAnimation = 'none'
  private phase: SpeakingGesturePhase = 'idle'
  private lastRequestedPhase: SpeakingGesturePhase = 'idle'
  private nextBehavior: AvatarBehaviorId | 'none' = 'none'
  private skippedCandidates: string[] = []
  private selectionReason = 'none'
  private schedulerDecision = 'inactive'

  begin(effect: AvatarStateEffect, state?: CharacterState): SpeakingGestureDecision {
    this.active = true
    this.sessionId += 1
    this.elapsedMs = 0
    this.nextGestureInMs = 0
    this.currentGesture = 'none'
    this.lastScheduledAnimation = 'none'
    this.phase = 'beginning'
    this.lastRequestedPhase = 'beginning'
    this.skippedCandidates = []
    const behaviorId = this.resolveBehavior(effect, state, this.phase)
    this.nextBehavior = behaviorId
    this.selectionReason = `session start; ${this.describePresence(state)}`
    this.schedulerDecision = `request ${behaviorId} for beginning`
    return {
      shouldRequest: true,
      behaviorId,
      phase: this.phase,
      reason: this.schedulerDecision,
    }
  }

  update(
    delta: number,
    effect: AvatarStateEffect,
    state?: CharacterState,
  ): SpeakingGestureDecision | null {
    if (!this.active) return null

    this.elapsedMs += Math.max(0, delta * 1000)
    this.nextGestureInMs = Math.max(0, this.nextGestureInMs - Math.max(0, delta * 1000))
    this.phase = this.resolvePhase(state)
    const behaviorId = this.resolveBehavior(effect, state, this.phase)
    this.nextBehavior = behaviorId
    const urgentPhaseChange =
      this.phase !== this.lastRequestedPhase &&
      (this.phase === 'ending' || this.phase === 'emotional-peak')

    if (this.nextGestureInMs > 0 && !urgentPhaseChange) {
      this.schedulerDecision = `waiting ${Math.round(this.nextGestureInMs)}ms`
      return null
    }

    this.selectionReason = `${this.phase}; ${this.describePresence(state)}`
    this.schedulerDecision = `request ${behaviorId} for ${this.phase}`
    this.lastRequestedPhase = this.phase
    return {
      shouldRequest: true,
      behaviorId,
      phase: this.phase,
      reason: this.schedulerDecision,
    }
  }

  recordSelection(input: {
    animationId: string
    behaviorId: AvatarBehaviorId | string
    skippedCandidates: string[]
    selectionReason: string
    phase: SpeakingGesturePhase
  }): void {
    this.currentGesture = `${input.behaviorId}:${input.animationId}`
    this.lastScheduledAnimation = input.animationId
    this.skippedCandidates = [...input.skippedCandidates]
    this.selectionReason = input.selectionReason
    this.lastRequestedPhase = input.phase
    this.nextGestureInMs = this.randomIntervalMs()
    this.schedulerDecision = `scheduled ${input.animationId}; next in ${Math.round(this.nextGestureInMs)}ms`
  }

  end(): void {
    if (!this.active) return
    this.active = false
    this.phase = 'ending'
    this.lastRequestedPhase = 'ending'
    this.nextGestureInMs = 0
    this.nextBehavior = 'neutral'
    this.schedulerDecision = 'speech ended; return to neutral speaking posture'
  }

  reset(): void {
    this.active = false
    this.sessionId = 0
    this.elapsedMs = 0
    this.nextGestureInMs = 0
    this.currentGesture = 'none'
    this.lastScheduledAnimation = 'none'
    this.phase = 'idle'
    this.lastRequestedPhase = 'idle'
    this.nextBehavior = 'none'
    this.skippedCandidates = []
    this.selectionReason = 'none'
    this.schedulerDecision = 'reset'
  }

  getExcludedAnimationIds(): string[] {
    return this.lastScheduledAnimation === 'none' ? [] : [this.lastScheduledAnimation]
  }

  getDebugState(): SpeakingGestureSchedulerDebugState {
    return {
      active: this.active,
      sessionId: this.sessionId,
      elapsedMs: Math.round(this.elapsedMs),
      phase: this.phase,
      currentGesture: this.currentGesture,
      nextGestureInMs: Math.round(this.nextGestureInMs),
      lastScheduledAnimation: this.lastScheduledAnimation,
      nextBehavior: this.nextBehavior,
      skippedCandidates: [...this.skippedCandidates],
      selectionReason: this.selectionReason,
      schedulerDecision: this.schedulerDecision,
    }
  }

  private resolvePhase(state?: CharacterState): SpeakingGesturePhase {
    const progress = state?.speechState.playbackProgress ?? 0
    const presence = state?.conversationPresence
    if (
      progress >= speakingGestureTuning.endingProgress ||
      presence?.responsePhase === 'finishingSpeech'
    )
      return 'ending'
    if (this.isEmotionalPeak(state)) return 'emotional-peak'
    return this.elapsedMs <= speakingGestureTuning.longReplyEarlyWindowMs ? 'beginning' : 'middle'
  }

  private resolveBehavior(
    effect: AvatarStateEffect,
    state: CharacterState | undefined,
    phase: SpeakingGesturePhase,
  ): AvatarBehaviorId {
    const emotionBehavior = effect.behaviorId
    if (phase === 'ending') return 'neutral'
    if (phase === 'emotional-peak') return emotionBehavior
    if (phase === 'beginning') return emotionBehavior === 'neutral' ? 'happy' : emotionBehavior

    const presence = state?.conversationPresence
    if (
      presence?.emphasis === 'joking' ||
      presence?.reaction === 'playful' ||
      presence?.reaction === 'amused'
    )
      return 'happy'
    if (presence?.emphasis === 'warning' || presence?.emphasis === 'disagreement') return 'angry'
    if (presence?.emphasis === 'confused' || presence?.reaction === 'curious') return 'surprised'
    if (presence?.engagement === 'high') return emotionBehavior
    if (emotionBehavior === 'whisper') return 'whisper'
    if (emotionBehavior === 'sad' || emotionBehavior === 'crying') return 'sad'
    if (emotionBehavior === 'sigh' || emotionBehavior === 'groan') return 'calm'
    return 'neutral'
  }

  private isEmotionalPeak(state?: CharacterState): boolean {
    const emotion = state?.emotion ?? ''
    if ((speakingGestureTuning.emotionalPeakBehaviors as readonly string[]).includes(emotion))
      return true
    const presence = state?.conversationPresence
    return (
      presence?.engagement === 'high' &&
      (presence.emphasis === 'celebrating' ||
        presence.emphasis === 'warning' ||
        presence.emphasis === 'joking' ||
        presence.reaction === 'impressed' ||
        presence.reaction === 'playful')
    )
  }

  private describePresence(state?: CharacterState): string {
    const presence = state?.conversationPresence
    if (!presence) return 'presence unavailable'
    return `presence ${presence.responsePhase}/${presence.replyLength}/${presence.engagement}/${presence.emphasis}/${presence.reaction}`
  }

  private randomIntervalMs(): number {
    const { min, max } = speakingGestureTuning.intervalMs
    return min + Math.random() * Math.max(0, max - min)
  }
}
