import assert from 'node:assert/strict'

import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { describe, it } from 'vitest'

import type { AvatarAnimationController } from '../../src/renderer/avatar/AvatarAnimationController'
import { AvatarAnimationQueue } from '../../src/renderer/avatar/AvatarAnimationQueue'
import type { AvatarBehaviorResolution } from '../../src/renderer/avatar/AvatarBehaviorResolver'
import { AvatarPlaybackCoordinator } from '../../src/renderer/avatar/AvatarPlaybackCoordinator'
import type { AvatarStateEffect } from '../../src/renderer/avatar/AvatarStateMachine'
import { AvatarGazeArbiter } from '../../src/renderer/avatar/embodiment/gaze/AvatarGazeArbiter'
import { LookTargetResolver } from '../../src/renderer/avatar/embodiment/gaze/LookAtRuntime'
import {
  AVATAR_MOTION_LAYERS,
  resolveAvatarMotionAuthority,
} from '../../src/renderer/avatar/embodiment/motion/AvatarMotionLayer'
import { BreathController } from '../../src/renderer/avatar/embodiment/motion/BreathController'
import { MicroMotionController } from '../../src/renderer/avatar/embodiment/motion/MicroMotionController'
import { ProceduralMotionController } from '../../src/renderer/avatar/embodiment/motion/ProceduralMotionController'
import { TailBehaviorRuntime } from '../../src/renderer/avatar/embodiment/secondary-motion/TailBehaviorRuntime'
import {
  AvatarRendererQuality,
  computeDrawingBufferSize,
  resolveEffectiveDpr,
} from '../../src/renderer/avatar/rendering/three/AvatarRendererQuality'
import type { VrmModel } from '../../src/renderer/avatar/rendering/three/VrmModel'
import { avatarLookAtTuning } from '../../src/renderer/avatar/tuning/motionTuning'

function main(): void {
  assert.deepEqual(AVATAR_MOTION_LAYERS, [
    'base',
    'gesture',
    'reaction',
    'procedural',
    'gaze',
    'facial',
    'secondary',
  ])
  const baseAuthority = resolveAvatarMotionAuthority({
    bodyLayer: 'base',
    directedGaze: false,
    screenGaze: false,
  })
  const gestureAuthority = resolveAvatarMotionAuthority({
    bodyLayer: 'gesture',
    directedGaze: false,
    screenGaze: false,
  })
  const reactionAuthority = resolveAvatarMotionAuthority({
    bodyLayer: 'reaction',
    directedGaze: false,
    screenGaze: false,
  })
  const screenAuthority = resolveAvatarMotionAuthority({
    bodyLayer: 'base',
    directedGaze: true,
    screenGaze: true,
  })
  assert.ok(gestureAuthority.proceduralUpperBodyWeight < baseAuthority.proceduralUpperBodyWeight)
  assert.ok(
    reactionAuthority.proceduralUpperBodyWeight < gestureAuthority.proceduralUpperBodyWeight,
  )
  assert.ok(screenAuthority.proceduralHeadWeight < gestureAuthority.proceduralHeadWeight)
  console.log('Motion layer contract and priorities: PASS')

  const gazeArbiter = new AvatarGazeArbiter()
  gazeArbiter.setBrowserScreenGaze('browser-session-a', true)
  assert.equal(gazeArbiter.resolve('idle'), 'screen')
  assert.equal(
    gazeArbiter.resolve('listening'),
    undefined,
    'user speech must win over browser gaze',
  )
  gazeArbiter.setConversationIntent({ intensity: 'subtle', gazeHint: 'user' })
  assert.equal(gazeArbiter.resolve('speaking'), 'user')
  gazeArbiter.setConversationIntent(undefined)
  assert.equal(
    gazeArbiter.resolve('speaking'),
    'screen',
    'browser gaze must resume after commentary',
  )
  gazeArbiter.setBrowserScreenGaze('stale-browser-session', false)
  assert.equal(
    gazeArbiter.resolve('idle'),
    'screen',
    'stale release must not clear the active session',
  )
  gazeArbiter.setBrowserScreenGaze('browser-session-a', false)
  assert.equal(gazeArbiter.resolve('idle'), undefined)
  console.log('Conversation, user speech, and bounded browser gaze arbitration: PASS')

  function makeHumanoidVrm(): {
    vrm: VRM
    bones: Record<string, THREE.Object3D>
  } {
    const names = [
      'spine',
      'chest',
      'head',
      'neck',
      'leftEye',
      'rightEye',
      'leftShoulder',
      'rightShoulder',
    ]
    const bones = Object.fromEntries(names.map((name) => [name, new THREE.Object3D()]))
    const scene = new THREE.Group()
    for (const bone of Object.values(bones)) scene.add(bone)
    return {
      bones,
      vrm: {
        scene,
        humanoid: {
          getNormalizedBoneNode: (name: string) => bones[name] ?? null,
        },
      } as unknown as VRM,
    }
  }

  function simulateProcedural(fps: number): {
    micro: ReturnType<MicroMotionController['getDebugState']>
    breath: ReturnType<BreathController['getDebugState']>
  } {
    const { vrm } = makeHumanoidVrm()
    const micro = new MicroMotionController(12345)
    const breath = new BreathController(67890)
    micro.attach(vrm)
    breath.attach(vrm)
    micro.setProfile({
      swayWeight: 0.8,
      postureWeight: 0.8,
      shoulderWeight: 0.6,
    })
    breath.setProfile({ speed: 0.2, intensity: 0.01, weight: 1, smoothing: 3.2 })
    const delta = 1 / fps
    const frameCount = 10 * 60 * fps
    for (let frame = 0; frame < frameCount; frame += 1) {
      micro.update(delta)
      breath.update(delta)
      const state = micro.getDebugState()
      const values = [
        state.spinePitch,
        state.spineRoll,
        state.chestYaw,
        state.shoulderLeft,
        state.shoulderRight,
        state.headPitch,
        state.headYaw,
        breath.getDebugState().offsetY,
      ]
      assert.ok(values.every(Number.isFinite))
      assert.ok(Math.abs(state.spinePitch) <= 0.0061)
      assert.ok(Math.abs(state.spineRoll) <= 0.0071)
      assert.ok(Math.abs(state.chestYaw) <= 0.0061)
      assert.ok(Math.abs(state.shoulderLeft) <= 0.0051)
      assert.ok(Math.abs(state.shoulderRight) <= 0.0051)
      assert.ok(Math.abs(breath.getDebugState().offsetY) <= breath.getDebugState().limit + 1e-8)
    }
    return { micro: micro.getDebugState(), breath: breath.getDebugState() }
  }

  const at30 = simulateProcedural(30)
  const at60 = simulateProcedural(60)
  const at120 = simulateProcedural(120)
  for (const key of [
    'spinePitch',
    'spineRoll',
    'chestYaw',
    'shoulderLeft',
    'shoulderRight',
  ] as const) {
    assert.ok(Math.abs(at30.micro[key] - at60.micro[key]) < 0.0015)
    assert.ok(Math.abs(at60.micro[key] - at120.micro[key]) < 0.0015)
  }
  assert.ok(Math.abs(at30.breath.offsetY - at120.breath.offsetY) < 0.0015)
  console.log('10-minute procedural bounds and FPS envelope: PASS')

  const firstRig = makeHumanoidVrm()
  const secondRig = makeHumanoidVrm()
  const staleController = new MicroMotionController(42)
  staleController.attach(firstRig.vrm)
  for (let frame = 0; frame < 180; frame += 1) staleController.update(1 / 60)
  staleController.attach(secondRig.vrm)
  const firstSpineAfterDetach = firstRig.bones.spine.rotation.clone()
  for (let frame = 0; frame < 180; frame += 1) staleController.update(1 / 60)
  assert.equal(firstRig.bones.spine.rotation.x, firstSpineAfterDetach.x)
  assert.equal(firstRig.bones.spine.rotation.z, firstSpineAfterDetach.z)
  assert.ok(Math.abs(firstRig.bones.spine.rotation.x) < 1e-8)
  assert.ok(Math.abs(firstRig.bones.spine.rotation.z) < 1e-8)
  console.log('Procedural VRM swap clears stale rig refs: PASS')

  const priorityRig = makeHumanoidVrm()
  const procedural = new ProceduralMotionController()
  procedural.attach(priorityRig.vrm)
  procedural.setBodyMotionLayer('gesture')
  procedural.setLookAtMode('screenFocus')
  procedural.update(1 / 60)
  const suppressed = procedural.getDebugState()
  assert.equal(suppressed.bodyLayer, 'gesture')
  assert.equal(suppressed.lookAtMode, 'screenFocus')
  assert.equal(suppressed.microMotion.upperBodyAuthority, 0.24)
  assert.equal(suppressed.microMotion.headAuthority, 0.04)
  procedural.setBodyMotionLayer('base')
  procedural.setLookAtMode('userFocus')
  assert.equal(procedural.getDebugState().microMotion.upperBodyAuthority, 1)
  assert.equal(procedural.getDebugState().microMotion.headAuthority, 0.32)
  procedural.detach()
  console.log('Procedural controller gesture/gaze priority: PASS')

  function makeTailScene(prefix: string): THREE.Group {
    const scene = new THREE.Group()
    let parent: THREE.Object3D = scene
    for (let index = 1; index <= 4; index += 1) {
      const bone = new THREE.Object3D()
      bone.name = `${prefix}_Tail_${index}`
      parent.add(bone)
      parent = bone
    }
    return scene
  }

  const missingTail = new TailBehaviorRuntime(55)
  missingTail.attach({ scene: new THREE.Group() } as unknown as VRM)
  for (let frame = 0; frame < 600; frame += 1) missingTail.update(1 / 60)
  assert.equal(missingTail.getDebugState().available, false)

  const tailA = makeTailScene('A')
  const tailB = makeTailScene('B')
  const tail = new TailBehaviorRuntime(56)
  tail.attach({ scene: tailA } as unknown as VRM)
  for (let frame = 0; frame < 10 * 60 * 120; frame += 1) {
    tail.update(1 / 120)
    const state = tail.getDebugState()
    assert.ok(Number.isFinite(state.yawOffset))
    assert.ok(Number.isFinite(state.rollOffset))
    assert.ok(Math.abs(state.yawOffset) <= state.limit)
    assert.ok(Math.abs(state.rollOffset) <= 0.055)
  }
  assert.equal(tail.getDebugState().available, true)
  tail.attach({ scene: tailB } as unknown as VRM)
  const tailARotations = tailA.children[0]?.rotation.clone()
  for (let frame = 0; frame < 600; frame += 1) tail.update(1 / 60)
  assert.ok(tailARotations)
  assert.ok(tailA.children[0])
  assert.equal(tailA.children[0].rotation.y, tailARotations.y)
  assert.equal(tailA.children[0].rotation.z, tailARotations.z)
  assert.ok(Math.abs(tailA.children[0].rotation.y) < 1e-8)
  assert.ok(Math.abs(tailA.children[0].rotation.z) < 1e-8)
  assert.ok(Math.abs(tail.getDebugState().yawOffset) <= tail.getDebugState().limit)
  console.log('Optional/missing tail and VRM swap lifecycle: PASS')

  const gazeTarget = new THREE.Object3D()
  const gazeBase = new THREE.Object3D()
  const gaze = new LookTargetResolver(99)
  const screen = gaze.resolve({
    deltaMs: 16,
    mode: 'screenFocus',
    modeTuning: avatarLookAtTuning.modes.screenFocus,
    baseTarget: gazeBase,
    target: gazeTarget,
  })
  assert.equal(screen.targetKind, 'screenContext')
  for (let frame = 0; frame < 180; frame += 1) {
    const current = gaze.resolve({
      deltaMs: 1000 / 60,
      mode: 'screenFocus',
      modeTuning: avatarLookAtTuning.modes.screenFocus,
      baseTarget: gazeBase,
      target: gazeTarget,
    })
    assert.equal(current.targetKind, 'screenContext')
  }
  const released = gaze.resolve({
    deltaMs: 16,
    mode: 'userFocus',
    modeTuning: avatarLookAtTuning.modes.userFocus,
    baseTarget: gazeBase,
    target: gazeTarget,
  })
  assert.notEqual(released.targetKind, 'screenContext')
  console.log('Screen-aware gaze ownership and release: PASS')

  for (const [input, expected] of [
    [1, 1],
    [1.25, 1.25],
    [1.5, 1.5],
    [2, 2],
    [3, 2],
  ] as const) {
    assert.equal(resolveEffectiveDpr(input), expected)
  }
  assert.deepEqual(computeDrawingBufferSize(800, 600, 1.5), { width: 1200, height: 900 })
  assert.deepEqual(computeDrawingBufferSize(1600, 900, resolveEffectiveDpr(3)), {
    width: 3200,
    height: 1800,
  })

  const uniformTexture = new THREE.Texture()
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: uniformTexture } },
  })
  const textureMesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
  const textureRoot = new THREE.Group()
  textureRoot.add(textureMesh)
  const quality = new AvatarRendererQuality()
  const textureQuality = quality.configureModel(textureRoot, {
    capabilities: { getMaxAnisotropy: () => 16 },
  } as unknown as THREE.WebGLRenderer)
  assert.equal(textureQuality.textureCount, 1)
  assert.equal(textureQuality.anisotropy, 8)
  assert.equal(uniformTexture.anisotropy, 8)
  assert.equal(uniformTexture.version, 1)
  console.log('Bounded DPR, backing-size, and MToon-uniform texture audit: PASS')

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
  const oneShotVrmModel = {
    setBodyMotionLayer: () => undefined,
    getBodyActionDebugState: () => ({ transitionRemaining: 0 }),
  } as unknown as VrmModel
  const oneShotCoordinator = new AvatarPlaybackCoordinator(
    oneShotAnimationController,
    oneShotVrmModel,
  )
  oneShotCoordinator.requestResolvedBehavior({
    effect: { mode: 'idle' } as AvatarStateEffect,
    resolved: {
      animationId: 'yawn',
      behaviorId: 'idle',
      loop: false,
      motionLayer: 'gesture',
      fallbackAnimationId: 'neutral_idle',
      selectionReason: 'focused one-shot recovery repro',
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
