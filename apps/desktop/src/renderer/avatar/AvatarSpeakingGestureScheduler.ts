import type { CharacterState } from '../../shared/runtime/characterState'
import { speakingGestureTuning } from '../three/avatarTuning'
import type { AvatarBehaviorId } from './AvatarBehaviorResolver'
import type { AvatarStateEffect } from './AvatarStateMachine'

export type SpeakingGesturePhase = 'opening' | 'holding' | 'emphasis' | 'closing'

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
  private phase: SpeakingGesturePhase = 'closing'
  private openingHoldMs = 0
  private holdingSwitchAtMs = 0
  private holdingSwitches = 0
  private emphasisCooldownMs = 0
  private emphasisPending = false
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
    this.phase = 'opening'
    this.openingHoldMs = this.randomRange(
      speakingGestureTuning.openingHoldMs.min,
      speakingGestureTuning.openingHoldMs.max,
    )
    this.holdingSwitchAtMs = this.randomRange(
      speakingGestureTuning.longReplySwitchMs.min,
      speakingGestureTuning.longReplySwitchMs.max,
    )
    this.holdingSwitches = 0
    this.emphasisCooldownMs = 0
    this.emphasisPending = false
    this.skippedCandidates = []
    const behaviorId = this.resolveBehavior(effect, state, this.phase)
    this.nextBehavior = behaviorId
    this.selectionReason = `session start; ${this.describePresence(state)}`
    this.schedulerDecision = `request ${behaviorId} for opening`
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
    const deltaMs = Math.max(0, delta * 1000)
    this.nextGestureInMs = Math.max(0, this.nextGestureInMs - deltaMs)
    this.emphasisCooldownMs = Math.max(0, this.emphasisCooldownMs - deltaMs)
    if (state?.conversationPresence.responsePhase === 'finishingSpeech') {
      this.phase = 'closing'
      this.schedulerDecision = 'closing; no new speaking clip'
      return null
    }

    if (this.emphasisPending && this.emphasisCooldownMs <= 0) {
      this.emphasisPending = false
      this.phase = 'emphasis'
    } else if (
      this.isLongReply(state) &&
      this.elapsedMs >= this.holdingSwitchAtMs &&
      this.holdingSwitches < speakingGestureTuning.maxHoldingSwitches
    ) {
      this.phase = 'holding'
    } else {
      this.phase = this.elapsedMs < this.openingHoldMs ? 'opening' : 'holding'
      this.schedulerDecision =
        this.elapsedMs < this.openingHoldMs
          ? `opening hold ${Math.round(this.openingHoldMs - this.elapsedMs)}ms`
          : 'holding current speaking gesture'
      return null
    }

    const behaviorId = this.resolveBehavior(effect, state, this.phase)
    this.nextBehavior = behaviorId
    this.selectionReason = `${this.phase}; ${this.describePresence(state)}`
    this.schedulerDecision = `request ${behaviorId} for ${this.phase}`
    return {
      shouldRequest: true,
      behaviorId,
      phase: this.phase,
      reason: this.schedulerDecision,
    }
  }

  beginSegment(emotionKey: string): void {
    if (!this.active) return
    if (
      (speakingGestureTuning.emotionalPeakBehaviors as readonly string[]).includes(emotionKey) &&
      this.emphasisCooldownMs <= 0
    ) {
      this.emphasisPending = true
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
    if (input.phase === 'holding') this.holdingSwitches += 1
    if (input.phase === 'emphasis')
      this.emphasisCooldownMs = speakingGestureTuning.emphasisCooldownMs
    this.nextGestureInMs =
      input.phase === 'opening'
        ? Math.max(0, this.holdingSwitchAtMs - this.elapsedMs)
        : this.emphasisCooldownMs
    this.schedulerDecision = `scheduled ${input.animationId}; phase=${input.phase}`
  }

  end(): void {
    if (!this.active) return
    this.active = false
    this.phase = 'closing'
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
    this.phase = 'closing'
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

  private resolveBehavior(
    effect: AvatarStateEffect,
    state: CharacterState | undefined,
    phase: SpeakingGesturePhase,
  ): AvatarBehaviorId {
    const emotionBehavior = effect.behaviorId
    if (phase === 'closing') return 'neutral'
    if (phase === 'emphasis') return emotionBehavior
    if (phase === 'opening') return emotionBehavior === 'neutral' ? 'happy' : emotionBehavior

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

  private isLongReply(state?: CharacterState): boolean {
    const length = state?.conversationPresence.replyLength
    return length === 'long' || length === 'veryLong'
  }

  private describePresence(state?: CharacterState): string {
    const presence = state?.conversationPresence
    if (!presence) return 'presence unavailable'
    return `presence ${presence.responsePhase}/${presence.replyLength}/${presence.engagement}/${presence.emphasis}/${presence.reaction}`
  }

  private randomRange(min: number, max: number): number {
    return min + Math.random() * Math.max(0, max - min)
  }
}
