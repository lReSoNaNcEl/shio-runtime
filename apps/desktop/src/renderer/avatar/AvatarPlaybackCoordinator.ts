import type { AvatarAnimationController } from './AvatarAnimationController'
import {
  AvatarAnimationQueue,
  type AvatarAnimationQueueDecision,
  type AvatarAnimationQueueItem,
} from './AvatarAnimationQueue'
import type { AvatarBehaviorResolution } from './AvatarBehaviorResolver'
import type { AvatarBehaviorTransitionLogEntry } from './AvatarDebugSnapshotBuilder'
import {
  AvatarPlaybackRequestLog,
  type AvatarPlaybackRequestSource,
} from './AvatarPlaybackRequestLog'
import type { AvatarMode, AvatarStateEffect } from './AvatarStateMachine'
import { type AvatarTransitionDecision, AvatarTransitionPolicy } from './AvatarTransitionPolicy'
import type { AnimationId } from './animationManifest'
import type { VrmModel } from './rendering/three/VrmModel'

interface PlaybackContext {
  animationId: string
  mode: AvatarMode
  behaviorId: string
}

interface PlaybackRequestInput {
  effect: AvatarStateEffect
  resolved: AvatarBehaviorResolution
  source: AvatarPlaybackRequestSource
  reason: string
  frame: number
  forceReplay?: boolean
  interruptible: boolean
}

interface DirectPlaybackInput {
  item: AvatarAnimationQueueItem
  fallbackAnimationId?: AnimationId
  source: AvatarPlaybackRequestSource
  reason: string
  frame: number
  forceReplay?: boolean
  blendDurationOverride?: number
}

export class AvatarPlaybackCoordinator {
  private animationQueue = new AvatarAnimationQueue()
  private transitionPolicy = new AvatarTransitionPolicy()
  private playbackRequests = new AvatarPlaybackRequestLog()
  private currentPlaybackContext: PlaybackContext | null = null
  private behaviorTimeline: AvatarBehaviorTransitionLogEntry[] = []
  private lastTransitionDecision: AvatarTransitionDecision | null = null

  constructor(
    private readonly animations: AvatarAnimationController,
    private readonly vrmModel: VrmModel,
  ) {}

  reset(): void {
    this.animationQueue.clear()
    this.currentPlaybackContext = null
  }

  clearPending(): void {
    this.animationQueue.clearPending()
  }

  getQueue(): AvatarAnimationQueue {
    return this.animationQueue
  }

  getPlaybackRequests(): AvatarPlaybackRequestLog {
    return this.playbackRequests
  }

  getCurrentContext(): PlaybackContext | null {
    return this.currentPlaybackContext
  }

  getLastTransitionDecision(): AvatarTransitionDecision | null {
    return this.lastTransitionDecision
  }

  getBehaviorTimeline(): AvatarBehaviorTransitionLogEntry[] {
    return this.behaviorTimeline
  }

  shouldHoldSpeakingBehavior(
    effect: AvatarStateEffect,
    resolved: AvatarBehaviorResolution,
  ): boolean {
    return (
      effect.mode === 'speaking' &&
      this.currentPlaybackContext?.mode === 'speaking' &&
      this.currentPlaybackContext.behaviorId === resolved.behaviorId
    )
  }

  recordRejectedResolvedBehavior(input: {
    effect: AvatarStateEffect
    resolved: AvatarBehaviorResolution
    source: AvatarPlaybackRequestSource
    reason: string
    frame: number
    rejectionReason: string
  }): void {
    this.recordBehaviorTransition(
      input.effect,
      input.resolved,
      input.source,
      input.reason,
      input.frame,
      false,
    )
    this.recordPlaybackRequest({
      frame: input.frame,
      animationId: input.resolved.animationId,
      behaviorId: input.resolved.behaviorId,
      source: input.source,
      reason: input.reason,
      accepted: false,
      decision: 'ignored',
      rejectionReason: input.rejectionReason,
    })
  }

  recordPlaybackOnly(input: {
    animationId: string
    behaviorId: string
    source: AvatarPlaybackRequestSource
    reason: string
    accepted: boolean
    decision: 'play' | 'queue' | 'discard' | 'ignored'
    rejectionReason: string | null
    frame: number
  }): void {
    this.recordPlaybackRequest(input)
  }

  requestResolvedBehavior(input: PlaybackRequestInput): AvatarAnimationQueueDecision {
    const decision = this.animationQueue.request({
      animationId: input.resolved.animationId,
      behaviorId: input.resolved.behaviorId,
      mode: input.effect.mode,
      loop: input.resolved.loop,
      interruptible: input.interruptible,
    })
    const requestReason = `${input.reason}; ${input.resolved.selectionReason}; queue: ${decision.reason}`
    this.recordPlaybackRequest({
      frame: input.frame,
      animationId: input.resolved.animationId,
      behaviorId: input.resolved.behaviorId,
      source: input.source,
      reason: requestReason,
      accepted: decision.action === 'play' || decision.action === 'queue',
      decision: decision.action,
      rejectionReason:
        decision.action === 'ignored'
          ? 'already active'
          : decision.action === 'discard'
            ? decision.reason
            : null,
    })
    this.recordBehaviorTransition(
      input.effect,
      input.resolved,
      input.source,
      requestReason,
      input.frame,
      decision.action === 'play' || decision.action === 'queue',
    )
    if (decision.action === 'play') {
      this.playQueuedItem({
        item: decision.item,
        fallbackAnimationId: input.resolved.fallbackAnimationId,
        source: input.source,
        reason: input.reason,
        frame: input.frame,
        forceReplay: input.forceReplay,
      })
    }
    return decision
  }

  playResolvedImmediately(input: {
    effect: AvatarStateEffect
    resolved: AvatarBehaviorResolution
    item: AvatarAnimationQueueItem
    source: AvatarPlaybackRequestSource
    reason: string
    frame: number
    forceReplay?: boolean
    blendDurationOverride?: number
  }): void {
    this.recordPlaybackRequest({
      frame: input.frame,
      animationId: input.resolved.animationId,
      behaviorId: input.resolved.behaviorId,
      source: input.source,
      reason: input.reason,
      accepted: true,
      decision: 'play',
      rejectionReason: null,
    })
    this.recordBehaviorTransition(
      input.effect,
      input.resolved,
      input.source,
      input.reason,
      input.frame,
      true,
    )
    this.animationQueue.replaceCurrent(input.item)
    this.playQueuedItem({
      item: input.item,
      fallbackAnimationId: input.resolved.fallbackAnimationId,
      source: input.source,
      reason: input.reason,
      frame: input.frame,
      forceReplay: input.forceReplay,
      blendDurationOverride: input.blendDurationOverride,
    })
  }

  recordDuplicateImmediate(input: {
    effect: AvatarStateEffect
    resolved: AvatarBehaviorResolution
    source: AvatarPlaybackRequestSource
    reason: string
    frame: number
  }): void {
    this.recordPlaybackRequest({
      frame: input.frame,
      animationId: input.resolved.animationId,
      behaviorId: input.resolved.behaviorId,
      source: input.source,
      reason: input.reason,
      accepted: false,
      decision: 'ignored',
      rejectionReason: 'already active',
    })
    this.recordBehaviorTransition(
      input.effect,
      input.resolved,
      input.source,
      input.reason,
      input.frame,
      false,
    )
  }

  advanceQueue(frame: number): void {
    const current = this.animationQueue.getCurrent()
    if (!current || current.loop) return

    const animation = this.animations.getDebugState()
    if (animation.isPlaybackActive || animation.playbackStatus === 'loading') return

    const next = this.animationQueue.completeCurrent()
    if (next) {
      this.playQueuedItem({
        item: next,
        source: 'queue',
        reason: 'previous one-shot completed',
        frame,
      })
    }
  }

  previewAnimation(input: {
    animationId: string
    loop: boolean
    mode: AvatarMode
    frame: number
  }): void {
    const decision = this.transitionPolicy.resolve({
      fromAnimationId: this.currentPlaybackContext?.animationId ?? null,
      toAnimationId: input.animationId,
      fromMode: this.currentPlaybackContext?.mode ?? null,
      toMode: input.mode,
      fromBehaviorId: this.currentPlaybackContext?.behaviorId ?? null,
      toBehaviorId: 'debug-preview',
    })
    this.lastTransitionDecision = decision
    void this.animations.playManifest(input.animationId, input.loop, {
      blendDuration: decision.blendDuration,
      forceReplay: true,
      requestSource: 'debug-preview',
      requestReason: 'manual debug preview',
      behaviorId: 'debug-preview',
      frame: input.frame,
      previousAnimationId: this.currentPlaybackContext?.animationId ?? null,
    })
  }

  private playQueuedItem(input: DirectPlaybackInput): void {
    const transition = this.transitionPolicy.resolve({
      fromAnimationId: this.currentPlaybackContext?.animationId ?? null,
      toAnimationId: input.item.animationId,
      fromMode: this.currentPlaybackContext?.mode ?? null,
      toMode: input.item.mode,
      fromBehaviorId: this.currentPlaybackContext?.behaviorId ?? null,
      toBehaviorId: input.item.behaviorId,
    })
    const effectiveTransition =
      input.blendDurationOverride === undefined
        ? transition
        : {
            ...transition,
            blendDuration: Math.max(transition.blendDuration, input.blendDurationOverride),
          }
    this.lastTransitionDecision = effectiveTransition
    const alreadyActive =
      this.currentPlaybackContext?.animationId === input.item.animationId &&
      this.animations.getDebugState().isPlaybackActive
    if (alreadyActive && !input.forceReplay && !effectiveTransition.restartRequired) {
      this.recordPlaybackRequest({
        frame: input.frame,
        animationId: input.item.animationId,
        behaviorId: input.item.behaviorId,
        source: input.source,
        reason: `${input.reason}; transition: ${effectiveTransition.policyId}`,
        accepted: false,
        decision: 'ignored',
        rejectionReason: 'already active',
      })
      return
    }
    const previousAnimationId = this.currentPlaybackContext?.animationId ?? null
    this.currentPlaybackContext = {
      animationId: input.item.animationId,
      mode: input.item.mode,
      behaviorId: input.item.behaviorId,
    }
    void this.animations.playManifest(input.item.animationId, input.item.loop, {
      fallbackId: input.fallbackAnimationId,
      blendDuration: effectiveTransition.blendDuration,
      forceReplay: input.forceReplay,
      requestSource: input.source,
      requestReason: `${input.reason}; transition: ${effectiveTransition.policyId}`,
      behaviorId: input.item.behaviorId,
      frame: input.frame,
      previousAnimationId,
    })
  }

  private recordPlaybackRequest(input: {
    frame: number
    animationId: string
    behaviorId: string
    source: AvatarPlaybackRequestSource
    reason: string
    accepted: boolean
    decision: 'play' | 'queue' | 'discard' | 'ignored'
    rejectionReason: string | null
  }): void {
    this.playbackRequests.record({
      ...input,
      currentAnimationId: this.currentPlaybackContext?.animationId ?? null,
      requestedAnimationId: input.animationId === 'none' ? null : input.animationId,
      transitionPolicy: this.lastTransitionDecision?.policyId ?? 'none',
      transitionPending: this.vrmModel.getBodyActionDebugState().transitionRemaining > 0,
    })
  }

  private recordBehaviorTransition(
    effect: AvatarStateEffect,
    resolved: AvatarBehaviorResolution,
    source: AvatarPlaybackRequestSource,
    reason: string,
    frame: number,
    accepted: boolean,
  ): void {
    const entry: AvatarBehaviorTransitionLogEntry = {
      at: Date.now(),
      frame,
      fromBehaviorId: this.currentPlaybackContext?.behaviorId ?? 'none',
      toBehaviorId: resolved.behaviorId,
      fromAnimationId: this.currentPlaybackContext?.animationId ?? null,
      toAnimationId: resolved.animationId,
      mode: effect.mode,
      source,
      reason,
      accepted,
    }
    this.behaviorTimeline = [...this.behaviorTimeline, entry].slice(-40)
    console.log(
      `[BEHAVIORTRANS] frame=${entry.frame} ${entry.fromBehaviorId}->${entry.toBehaviorId} animation=${entry.fromAnimationId ?? 'none'}->${entry.toAnimationId} mode=${entry.mode} source=${source} accepted=${accepted} reason="${reason}"`,
    )
  }
}
