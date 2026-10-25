import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import type { AvatarAnimationController } from '../../src/renderer/avatar/AvatarAnimationController'
import { AvatarAnimationQueue } from '../../src/renderer/avatar/AvatarAnimationQueue'
import type { AvatarBehaviorResolution } from '../../src/renderer/avatar/AvatarBehaviorResolver'
import { AvatarPlaybackCoordinator } from '../../src/renderer/avatar/AvatarPlaybackCoordinator'
import type { AvatarStateEffect } from '../../src/renderer/avatar/AvatarStateMachine'
import type { AvatarModel } from '../../src/renderer/avatar/rendering/two/AvatarModel'

function main(): void {
  const queue = new AvatarAnimationQueue()
  const idle = queue.request({
    animationId: 'neutral_idle',
    behaviorId: 'idle',
    mode: 'idle',
    loop: true,
    motionLayer: 'base',
    interruptible: true,
  })
  assert.equal(idle.action, 'play')
  const speaking = queue.request({
    animationId: 'neutral2',
    behaviorId: 'neutral',
    mode: 'speaking',
    loop: true,
    motionLayer: 'base',
    interruptible: false,
  })
  assert.equal(speaking.action, 'play')
  const recovery = queue.request({
    animationId: 'neutral_idle',
    behaviorId: 'idle',
    mode: 'idle',
    loop: true,
    motionLayer: 'base',
    interruptible: true,
  })
  assert.equal(recovery.action, 'play')

  function assertLayerRecovery(layer: 'gesture' | 'reaction'): void {
    const layeredQueue = new AvatarAnimationQueue()
    const layered = layeredQueue.request({
      animationId: `${layer}-clip`,
      behaviorId: layer === 'reaction' ? 'surprised' : 'neutral',
      mode: 'idle',
      loop: false,
      motionLayer: layer,
      interruptible: false,
    })
    assert.equal(layered.action, 'play')
    assert.equal(layeredQueue.getCurrent()?.motionLayer, layer)
    const returnToIdle = layeredQueue.request({
      animationId: 'neutral_idle',
      behaviorId: 'idle',
      mode: 'idle',
      loop: true,
      motionLayer: 'base',
      interruptible: true,
    })
    assert.equal(returnToIdle.action, 'queue')
    assert.equal(layeredQueue.completeCurrent()?.motionLayer, 'base')
  }

  assertLayerRecovery('gesture')
  assertLayerRecovery('reaction')

  let oneShotPlaybackActive = true
  const oneShotPlaybackCalls: Array<{
    animationId: string
    loop: boolean
    motionLayer: string | undefined
  }> = []
  const oneShotAnimationController = {
    getDebugState: () => ({
      isPlaybackActive: oneShotPlaybackActive,
      playbackStatus: oneShotPlaybackActive ? 'playing' : 'idle',
    }),
    playManifest: (
      animationId: string,
      loop: boolean,
      options?: { motionLayer?: string },
    ): Promise<void> => {
      oneShotPlaybackCalls.push({ animationId, loop, motionLayer: options?.motionLayer })
      return Promise.resolve()
    },
  } as unknown as AvatarAnimationController
  const oneShotAvatarModel = {
    setBodyMotionLayer: () => undefined,
    getBodyActionDebugState: () => ({ transitionRemaining: 0 }),
  } as unknown as AvatarModel
  const oneShotCoordinator = new AvatarPlaybackCoordinator(
    oneShotAnimationController,
    oneShotAvatarModel,
  )
  oneShotCoordinator.requestResolvedBehavior({
    effect: { mode: 'idle' } as AvatarStateEffect,
    resolved: {
      animationId: 'breathe',
      behaviorId: 'idle',
      loop: false,
      motionLayer: 'gesture',
      fallbackAnimationId: 'neutral_idle',
      selectionReason: 'focused one-shot recovery repro',
      candidates: [],
      activeCooldowns: [],
    } as AvatarBehaviorResolution,
    source: 'idle-orchestrator',
    reason: 'focused one-shot recovery repro',
    frame: 1,
    interruptible: false,
  })
  oneShotPlaybackActive = false
  oneShotCoordinator.advanceQueue(2)
  assert.deepEqual(oneShotPlaybackCalls.at(-1), {
    animationId: 'neutral_idle',
    loop: true,
    motionLayer: 'base',
  })
  assert.equal(oneShotCoordinator.getQueue().getCurrent()?.animationId, 'neutral_idle')
  assert.equal(oneShotCoordinator.getQueue().getCurrent()?.loop, true)
  console.log('Unqueued one-shot immediate base-motion recovery: PASS')
  console.log('Idle/speaking/gesture/reaction recovery regression: PASS')

  console.log('Avatar Visual & Motion 3.0 focused repro: PASS')
}

describe('avatar visual motion', () => {
  it('preserves layered motion authority and playback recovery', () => {
    main()
  })
})
