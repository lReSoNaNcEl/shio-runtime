import { VRMUtils } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'

import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { FLASH_MOTION_FORMAT, HAND_BONE_NAMES, type MotionChunk } from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'
import { createMockMotionApi, createMotionChunk } from '../../support/avatar/motionFixtures'

afterEach(() => vi.unstubAllGlobals())

it.each([30, 60, 120])('eases the real-rig body handoff at both ends at %i Hz', async (hz) => {
  vi.stubGlobal('window', { api: { motion: createMockMotionApi() } })
  const vrm = greenFoxRig()
  const samples: THREE.Quaternion[] = []
  const owner = new GeneratedBodyPlayback(
    () => undefined,
    (sample) => {
      if (sample.stage === 'transition' && sample.bone === 'rightUpperArm')
        samples.push(new THREE.Quaternion().fromArray(sample.rotation))
    },
  )
  owner.attach(vrm)
  try {
    await owner.playProfile('explain_one_palm', {
      animationId: 'explain_one_palm',
      behaviorId: 'test',
      source: 'debug-preview',
      reason: 'handoff continuity',
      previousAnimationId: null,
      blendDuration: 1,
      forceReplay: false,
      motionLayer: 'gesture',
    })
    const origin = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')?.quaternion.clone()
    if (!origin) throw new Error('Missing real-rig arm')
    const finger = vrm.humanoid.getNormalizedBoneNode('rightIndexProximal')
    if (!finger) throw new Error('Missing real-rig finger')
    const fingerOrigin = finger.quaternion.clone()
    const fingerSamples: THREE.Quaternion[] = []
    const body = owner as unknown as {
      cursor: number
      lastPoseFrame: number
      apply: (chunk: MotionChunk, delta: number, progress: number) => void
    }
    const chunk = createMotionChunk({
      profileId: 'explain_one_palm',
      flashMotion: {
        mode: 's2g',
        weightsRevision: FLASH_MOTION_FORMAT.weightsRevision,
        speech: { playbackId: 'preview', startSample: 0, frames: 60 },
        fingers: Array.from({ length: 60 }, () =>
          HAND_BONE_NAMES.map((name) =>
            new THREE.Quaternion()
              .setFromAxisAngle(new THREE.Vector3(0, 0, 1), name === 'rightIndexProximal' ? 0.6 : 0)
              .toArray(),
          ),
        ),
      },
    })
    for (let frame = 1; frame <= hz; frame++) {
      body.lastPoseFrame = ((frame - 1) * 30) / hz
      body.cursor = (frame * 30) / hz
      owner.setClock({
        turnId: 'transition-test',
        playbackId: 'preview',
        sourceSampleRate: 44_100,
        sourceSampleOffset: Math.round(body.cursor * 1470),
        state: 'playing',
      })
      body.apply(chunk, 1 / hz, 0)
      fingerSamples.push(finger.quaternion.clone())
    }
    const target = samples.at(-1)
    if (!target) throw new Error('Missing transition samples')
    const distance = origin.angleTo(target)
    expect(distance).toBeGreaterThan(0.1)
    // The linear handoff used to spend exactly 1/hz of its entire angle on
    // these endpoint frames. The same duration now begins and ends gently.
    expect(origin.angleTo(samples[0])).toBeLessThan(distance / hz / 10)
    expect(samples.at(-2)?.angleTo(target)).toBeLessThan(distance / hz / 10)
    expect(origin.angleTo(samples[hz / 2 - 1])).toBeCloseTo(distance / 2, 5)
    // It still arrives at the generated target on time with normalized bones.
    expect(target.length()).toBeCloseTo(1, 10)
    const fingerTarget = fingerSamples.at(-1)
    if (!fingerTarget) throw new Error('Missing finger samples')
    const fingerDistance = fingerOrigin.angleTo(fingerTarget)
    expect(fingerDistance).toBeGreaterThan(0.1)
    expect(fingerOrigin.angleTo(fingerSamples[0])).toBeLessThan(fingerDistance / hz / 10)
    expect(fingerSamples.at(-2)?.angleTo(fingerTarget)).toBeLessThan(fingerDistance / hz / 10)
  } finally {
    owner.detach()
    await owner.settleCancellation()
    VRMUtils.deepDispose(vrm.scene)
  }
})
