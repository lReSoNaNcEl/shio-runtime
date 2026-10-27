import type { BodyTurnIntent } from '../../shared/motion'
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
import { type AnimationId, getAnimation } from './animationManifest'
import type { VrmModel } from './rendering/three/VrmModel'

interface PlaybackContext {
  executionId: string | null
  animationId: string
  mode: AvatarMode
  behaviorId: string
  motionLayer: AvatarAnimationQueueItem['motionLayer']
  completionFallbackAnimationId?: AnimationId
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
  bodyAction?: BodyTurnIntent
  seed?: number
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
    this.vrmModel.setBodyMotionLayer('base')
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

  adoptPreparedSpeaking(expected: PlaybackContext, frame: number): boolean {
    const current = this.animationQueue.getCurrent()
    const animation = this.animations.getDebugState()
    if (
      this.currentPlaybackContext !== expected ||
      expected.mode !== 'awaitingSpeech' ||
      current?.animationId !== expected.animationId ||
      animation.activeAnimationId !== expected.animationId ||
      !(animation.playbackStatus === 'loading' || animation.isPlaybackActive)
    )
      return false
    expected.mode = 'speaking'
    current.mode = 'speaking'
    this.recordPlaybackOnly({
      animationId: expected.animationId,
      behaviorId: expected.behaviorId,
      source: 'speaking-gesture-scheduler',
      reason: 'adopt exact prepared speech execution without restart',
      accepted: true,
      decision: 'play',
      rejectionReason: null,
      frame,
    })
    return true
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
    if (
      input.source === 'idle-orchestrator' &&
      this.currentPlaybackContext?.behaviorId === 'debug-preview'
    ) {
      const animation = this.animations.getDebugState()
      if (animation.isPlaybackActive || animation.playbackStatus === 'loading') {
        const reason = 'manual debug preview active'
        this.recordRejectedResolvedBehavior({ ...input, rejectionReason: reason })
        return {
          action: 'ignored',
          item: {
            id: 0,
            animationId: input.resolved.animationId,
            behaviorId: input.resolved.behaviorId,
            mode: input.effect.mode,
            loop: input.resolved.loop,
            motionLayer: input.resolved.motionLayer,
            enqueueTime: Date.now(),
            interruptible: input.interruptible,
          },
          interruptedItem: null,
          reason,
        }
      }
    }
    const decision = this.animationQueue.request(
      {
        animationId: input.resolved.animationId,
        behaviorId: input.resolved.behaviorId,
        mode: input.effect.mode,
        loop: input.resolved.loop,
        motionLayer: input.resolved.motionLayer,
        interruptible: input.interruptible,
      },
      input.forceReplay,
    )
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
    if (!current) return
    const animation = this.animations.getDebugState()
    if (animation.playbackStatus === 'failed') {
      this.reset()
      return
    }
    const execution = this.vrmModel.getBodyMotionDebugState().motionExecution
    const context = this.currentPlaybackContext
    if (
      context &&
      context.executionId === null &&
      animation.playbackStatus !== 'loading' &&
      execution?.executionId &&
      execution.profileId === animation.activeAnimationId
    )
      context.executionId = execution.executionId
    if (animation.isPlaybackActive || animation.playbackStatus === 'loading') return

    // Rejected startup has no execution to bind. All other terminal outcomes
    // must belong to the exact execution accepted for this queue item.
    const skippedStartup =
      context?.executionId === null &&
      animation.playbackStatus === 'idle' &&
      animation.activeAnimationId === null
    if (
      !skippedStartup &&
      (!context?.executionId || context.executionId !== execution?.executionId)
    )
      return
    const outcome = skippedStartup ? 'superseded' : execution?.outcome
    if (!outcome) return
    if (outcome !== 'completed' && outcome !== 'superseded') {
      this.reset()
      return
    }
    const presenceRecovered = current.loop
    const completedContext = this.currentPlaybackContext
    const next = this.animationQueue.completeCurrent()
    if (next) {
      this.playQueuedItem({
        item: next,
        source: 'queue',
        reason: `previous generated execution ${outcome}`,
        frame,
      })
      return
    }

    const completionFallbackAnimationId =
      completedContext?.completionFallbackAnimationId ??
      (presenceRecovered
        ? (getAnimation(current.animationId)?.id as AnimationId | undefined)
        : undefined)
    if (
      completionFallbackAnimationId &&
      (presenceRecovered || completionFallbackAnimationId !== completedContext?.animationId)
    ) {
      const fallbackItem: AvatarAnimationQueueItem = {
        id: 0,
        animationId: completionFallbackAnimationId,
        behaviorId: `${completedContext?.mode ?? current.mode}-completion-fallback`,
        mode: completedContext?.mode ?? current.mode,
        loop: true,
        motionLayer: 'base',
        enqueueTime: Date.now(),
        interruptible: true,
      }
      this.animationQueue.replaceCurrent(fallbackItem)
      this.playQueuedItem({
        item: fallbackItem,
        fallbackAnimationId: completionFallbackAnimationId,
        source: 'queue',
        reason: 'completed one-shot; immediate base-motion recovery',
        frame,
      })
      return
    }

    this.currentPlaybackContext = null
    this.vrmModel.setBodyMotionLayer('base')
  }

  previewAnimation(input: {
    bodyAction?: BodyTurnIntent
    requestSource?: AvatarPlaybackRequestSource
    seed?: number
    animationId: string
    loop: boolean
    mode: AvatarMode
    frame: number
  }): void {
    const previous = this.currentPlaybackContext
    const previousItem = this.animationQueue.getCurrent()
    const fallbackAnimationId =
      previous?.completionFallbackAnimationId ??
      (previousItem?.loop
        ? (getAnimation(previousItem.animationId)?.id as AnimationId | undefined)
        : undefined)
    const item: AvatarAnimationQueueItem = {
      id: 0,
      animationId: input.animationId,
      behaviorId: 'debug-preview',
      mode: input.mode,
      loop: input.loop,
      motionLayer: 'base',
      enqueueTime: Date.now(),
      interruptible: true,
    }
    // Preview owns the same queue/context as ordinary generated playback. Old
    // pending items cannot restore a different profile while the preview runs.
    this.animationQueue.clearPending()
    this.animationQueue.replaceCurrent(item)
    this.playQueuedItem({
      item,
      fallbackAnimationId,
      source: input.requestSource ?? 'debug-preview',
      reason: 'manual debug preview',
      bodyAction: input.bodyAction,
      seed: input.seed,
      frame: input.frame,
      forceReplay: true,
    })
    this.recordPlaybackRequest({
      frame: input.frame,
      animationId: input.animationId,
      behaviorId: 'debug-preview',
      source: 'debug-preview',
      reason: 'manual debug preview',
      accepted: true,
      decision: 'play',
      rejectionReason: null,
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
      executionId: null,
      animationId: input.item.animationId,
      mode: input.item.mode,
      behaviorId: input.item.behaviorId,
      motionLayer: input.item.motionLayer,
      completionFallbackAnimationId: input.fallbackAnimationId,
    }
    this.vrmModel.setBodyMotionLayer(input.item.motionLayer)
    const context = this.currentPlaybackContext
    void this.animations
      .playManifest(input.item.animationId, input.item.loop, {
        fallbackId: input.fallbackAnimationId,
        blendDuration: effectiveTransition.blendDuration,
        speechBound:
          input.source !== 'debug-preview' &&
          (input.item.mode === 'speaking' || input.item.mode === 'awaitingSpeech'),
        forceReplay: input.forceReplay,
        seed: input.seed,
        bodyAction: input.bodyAction,
        requestSource: input.source,
        requestReason: `${input.reason}; transition: ${effectiveTransition.policyId}`,
        behaviorId: input.item.behaviorId,
        frame: input.frame,
        previousAnimationId,
        motionLayer: input.item.motionLayer,
      })
      .then(() => {
        if (this.currentPlaybackContext !== context) return
        const execution = this.vrmModel.getBodyMotionDebugState().motionExecution
        const animation = this.animations.getDebugState()
        if (context.executionId === null && execution?.profileId === animation.activeAnimationId)
          context.executionId = execution?.executionId ?? null
      })
      .catch((error: unknown) => console.warn('Generated motion request failed', error))
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
      transitionPending: this.vrmModel.getBodyMotionDebugState().transitionRemaining > 0,
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
