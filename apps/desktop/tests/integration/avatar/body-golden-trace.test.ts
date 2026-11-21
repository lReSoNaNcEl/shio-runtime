import { createHash } from 'node:crypto'

import { type VRM, VRMUtils } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'

import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { GeneratedBodySafety } from '../../../src/renderer/avatar/rendering/three/GeneratedBodySafety'
import { getMotionProfile, type MotionApi, type MotionProfileId } from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'
import {
  createMockMotionApi,
  createMotionChunk,
  createMotionLease,
} from '../../support/avatar/motionFixtures'

/**
 * Golden traces of the generated body on the real rig. Behaviour-preserving
 * decomposition of GeneratedBodyPlayback/GeneratedBodySafety must keep these
 * hashes exactly; an intentional behaviour change updates them in its own commit.
 */
const PLAYBACK_GOLDEN_SHA256 = '29f559bdc21b63ab561feeb6061ff5a3c556225cd20494a3f0a15aac0bce178f'
const SAFETY_GOLDEN_SHA256 = 'a2ae21284103d5658d7e38765aaecb69265d6150a1e1d319826b3178d2fcddfd'

const rigs: VRM[] = []
afterEach(() => {
  for (const rig of rigs.splice(0)) VRMUtils.deepDispose(rig.scene)
  vi.unstubAllGlobals()
})

const round = (value: number) => Math.round(value * 1e6) / 1e6
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Deterministic, varied synthetic arm source: different frequencies per joint and side. */
type Quaternion = [number, number, number, number]

function sourceRotations(frame: number): Quaternion[] {
  return Array.from({ length: 30 }, (_, index) => {
    const lead = [17, 18, 19].includes(index)
    const support = [11, 12, 13].includes(index)
    if (!lead && !support) return [0, 0, 0, 1] as Quaternion
    const phase = frame / 30
    const sign = lead ? 1 : -1
    return new THREE.Quaternion()
      .setFromEuler(
        new THREE.Euler(
          0.6 * Math.sin(phase * 2.1 + index),
          sign * 0.5 * Math.sin(phase * 1.3 + index / 2),
          sign * (0.4 + 0.5 * Math.sin(phase * 3.7 + index / 3)),
        ),
      )
      .toArray() as Quaternion
  })
}

async function playbackTrace(profileId: MotionProfileId): Promise<unknown[]> {
  const vrm = greenFoxRig()
  rigs.push(vrm)
  const lease = createMotionLease({ sessionId: 'golden', seed: 23 })
  const next: MotionApi['next'] = async (input) => ({
    ok: true,
    chunk: createMotionChunk({
      ...input.lease,
      profileId: input.profileId,
      plan: input.plan,
      reset: input.fromFrame === 0,
      fromFrame: input.fromFrame ?? 0,
      startFrame: input.fromFrame ?? 0,
      inferenceMs: 1,
      rotations: Array.from({ length: 60 }, (_, frame) =>
        sourceRotations((input.fromFrame ?? 0) + frame),
      ),
      rootPositions: Array.from({ length: 60 }, (_, frame) => [
        0,
        0.9887084839474641 - 0.004 * Math.sin(((input.fromFrame ?? 0) + frame) / 9),
        0,
      ]),
    }),
  })
  vi.stubGlobal('window', { api: { motion: createMockMotionApi({ lease, next }) } })
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach(vrm)
  await owner.playProfile(profileId, {
    animationId: profileId,
    speechBound: true,
    behaviorId: 'golden',
    source: 'debug-preview',
    reason: 'golden trace',
    previousAnimationId: null,
    blendDuration: 0.1,
    forceReplay: false,
    motionLayer: 'base',
  })
  const names = [
    'hips',
    'spine',
    'chest',
    'leftUpperArm',
    'leftLowerArm',
    'leftHand',
    'rightUpperArm',
    'rightLowerArm',
    'rightHand',
    'leftUpperLeg',
    'rightLowerLeg',
  ] as const
  const trace: unknown[] = []
  for (let frame = 1; frame <= 240; frame++) {
    owner.setClock({
      turnId: 'golden-turn',
      playbackId: 'golden-pcm',
      sourceSampleRate: 44100,
      sourceSampleOffset: frame * 735,
      state: 'playing',
    })
    owner.setSpeechEnergy(0.2 + 0.15 * Math.sin(frame / 7))
    owner.update(1 / 60, () => undefined)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    if (frame % 8 === 0)
      trace.push(
        names.map((name) =>
          vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.toArray().map(round),
        ),
        round(vrm.humanoid.getNormalizedBoneNode('hips')?.position.y ?? 0),
      )
  }
  owner.detach()
  await owner.settleCancellation()
  return trace
}

function safetyTrace(): unknown[] {
  const vrm = greenFoxRig()
  rigs.push(vrm)
  const safety = new GeneratedBodySafety()
  safety.attach(vrm)
  safety.calibrateStandingPose()
  safety.setHandTargets(getMotionProfile('explain_one_palm'), 'stroke')
  const arm = (name: string) => vrm.humanoid.getNormalizedBoneNode(name as never)
  const trace: unknown[] = []
  for (let frame = 0; frame < 180; frame++) {
    for (const [name, index] of [
      ['rightUpperArm', 17],
      ['rightLowerArm', 18],
      ['rightHand', 19],
      ['leftUpperArm', 11],
      ['leftLowerArm', 12],
    ] as const) {
      const [x, y, z, w] = sourceRotations(frame)[index]
      const bone = arm(name)
      bone?.quaternion.set(x, y, z, w)
      if (bone) safety.constrainTarget(bone, bone.quaternion)
    }
    vrm.scene.updateMatrixWorld(true)
    safety.apply(1 / 60, 1, true, {
      motionClass: frame < 120 ? 'gesture' : 'presence',
      generatedSource: frame % 3 !== 0,
      phase: frame < 40 ? 'prepare' : frame < 120 ? 'stroke' : 'recover',
      reachSeconds: frame < 40 ? 0.5 : undefined,
    })
    if (frame % 6 === 0)
      trace.push(
        ['rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperArm', 'leftLowerArm'].map(
          (name) => arm(name)?.quaternion.toArray().map(round),
        ),
        safety.getDebugState(),
        safety.handTargetsReached(),
      )
  }
  return trace
}

it('keeps the generated body playback trace on the real rig', async () => {
  const gesture = await playbackTrace('explain_one_palm')
  const presence = await playbackTrace('presence_speaking')
  expect(digest(await playbackTrace('explain_one_palm'))).toBe(digest(gesture))
  // A golden trace is only meaningful when the body actually moves.
  for (const trace of [gesture, presence])
    expect(
      new Set(trace.filter(Array.isArray).map((entry) => JSON.stringify(entry))).size,
    ).toBeGreaterThan(10)
  expect(digest([gesture, presence])).toBe(PLAYBACK_GOLDEN_SHA256)
}, 60_000)

it('keeps the body safety trace on the real rig', () => {
  const trace = safetyTrace()
  expect(digest(safetyTrace())).toBe(digest(trace))
  expect(
    new Set(trace.filter(Array.isArray).map((entry) => JSON.stringify(entry))).size,
  ).toBeGreaterThan(10)
  expect(digest(trace)).toBe(SAFETY_GOLDEN_SHA256)
}, 60_000)
