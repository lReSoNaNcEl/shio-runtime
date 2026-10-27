import { readFileSync } from 'node:fs'

import { type VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { afterEach, expect, it, vi } from 'vitest'

import * as clearanceCalibration from '../../../src/renderer/avatar/rendering/three/GeneratedBodyCalibration'
import { calibrateBodyClearance } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyCalibration'
import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { GeneratedBodySafety } from '../../../src/renderer/avatar/rendering/three/GeneratedBodySafety'
import { getMotionProfile, type MotionApi, type MotionProfileId } from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('matches calibration through the production VRM loader and normalized hierarchy', async () => {
  vi.stubGlobal('self', globalThis)
  const loader = new GLTFLoader()
  loader.register(() => ({
    name: 'geometry-only-test',
    loadTexture: async () => new THREE.Texture(),
  }))
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const bytes = readFileSync(
    process.env.SHIO_TEST_VRM_PATH ??
      new URL('../../../src/renderer/assets/vrm/green_fox.vrm', import.meta.url),
  )
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  )
  const vrm = gltf.userData.vrm as VRM
  VRMUtils.removeUnnecessaryJoints(vrm.scene)
  const reference = calibrateBodyClearance(greenFoxRig())
  const actual = calibrateBodyClearance(vrm)
  if (!process.env.SHIO_TEST_VRM_PATH) expect(actual.halfWidth).toBeCloseTo(reference.halfWidth, 5)
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach(vrm)
  for (const side of ['left', 'right'] as const) {
    const hand = vrm.humanoid.getNormalizedBoneNode(`${side}Hand`)
    const shoulder = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`)
    if (!hand || !shoulder) throw new Error('Missing arm')
    expect(hand.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(
      shoulder.getWorldPosition(new THREE.Vector3()).y - 0.2,
    )
  }
  expect(owner.getBodyMotionDebugState().generated?.safety?.unresolvedArmContacts).toBe(0)
  vrm.humanoid.update()
  vrm.scene.updateMatrixWorld(true)
  for (const name of ['leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'] as const) {
    const normalized = vrm.humanoid
      .getNormalizedBoneNode(name)
      ?.getWorldPosition(new THREE.Vector3())
    const raw = vrm.humanoid.getRawBoneNode(name)?.getWorldPosition(new THREE.Vector3())
    if (!normalized || !raw) throw new Error('Missing arm')
    expect(normalized.distanceTo(raw), name).toBeLessThan(0.001)
  }
  VRMUtils.deepDispose(vrm.scene)
})

it('measures bind skin in the same frame even when normalized arms have already lowered', () => {
  const vrm = greenFoxRig()
  const before = calibrateBodyClearance(vrm)
  const arm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
  if (!arm) throw new Error('Missing arm')
  arm.rotation.z = -1.15
  vrm.scene.updateMatrixWorld(true)
  expect(calibrateBodyClearance(vrm).armRadius).toEqual(before.armRadius)
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it('keeps the calibrated standing reference relaxed with a wide costume envelope', () => {
  const vrm = greenFoxRig()
  const measured = calibrateBodyClearance(vrm)
  vi.spyOn(clearanceCalibration, 'calibrateBodyClearance').mockReturnValue({
    ...measured,
    halfWidth: 0.17,
    halfDepth: 0.12,
    armRadius: { left: 0.06, right: 0.06 },
  })
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach(vrm)
  for (const side of ['left', 'right'] as const) {
    const shoulder = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`)
    const wrist = vrm.humanoid.getNormalizedBoneNode(`${side}Hand`)
    if (!shoulder || !wrist) throw new Error('Missing arm')
    expect(
      shoulder.getWorldPosition(new THREE.Vector3()).y -
        wrist.getWorldPosition(new THREE.Vector3()).y,
    ).toBeGreaterThan(0.2)
  }
  expect(owner.getBodyMotionDebugState().generated?.safety?.unresolvedArmContacts).toBe(0)
  owner.detach()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it('keeps the actual standing reference beside the body instead of a lateral A-pose', () => {
  const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach(vrm)
  const hips = vrm.humanoid.getNormalizedBoneNode('hips')
  const chest = vrm.humanoid.getNormalizedBoneNode('chest')
  const neck = vrm.humanoid.getNormalizedBoneNode('neck')
  if (!hips || !chest || !neck) throw new Error('Missing torso')
  const down = hips
    .getWorldPosition(new THREE.Vector3())
    .sub(neck.getWorldPosition(new THREE.Vector3()))
    .normalize()
  const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')
  const right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
  if (!left || !right) throw new Error('Missing shoulders')
  const across = left
    .getWorldPosition(new THREE.Vector3())
    .sub(right.getWorldPosition(new THREE.Vector3()))
    .normalize()
  for (const side of ['left', 'right'] as const) {
    const shoulder = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`)
    const elbow = vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`)
    const wrist = vrm.humanoid.getNormalizedBoneNode(`${side}Hand`)
    if (!shoulder || !elbow || !wrist) throw new Error('Missing arm')
    const origin = shoulder.getWorldPosition(new THREE.Vector3())
    const upper = elbow.getWorldPosition(new THREE.Vector3()).sub(origin)
    const lower = wrist.getWorldPosition(new THREE.Vector3()).sub(origin).sub(upper)
    const maximumHeight =
      -origin.clone().sub(hips.getWorldPosition(new THREE.Vector3())).dot(down) -
      (upper.length() + lower.length()) * 0.85
    expect(
      -wrist
        .getWorldPosition(new THREE.Vector3())
        .sub(hips.getWorldPosition(new THREE.Vector3()))
        .dot(down),
    ).toBeLessThanOrEqual(maximumHeight + 0.001)
    expect(Math.atan2(Math.abs(upper.dot(across)), upper.dot(down))).toBeLessThan(
      (25 * Math.PI) / 180,
    )
    expect(wrist.getWorldPosition(new THREE.Vector3()).sub(origin).dot(down)).toBeGreaterThan(
      (upper.length() + lower.length()) * 0.85,
    )
  }
  expect(owner.getBodyMotionDebugState().generated?.safety?.unresolvedArmContacts).toBe(0)
  owner.detach()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it.each(['left', 'right'] as const)(
  'bounds a folded %s neural wrist in its anatomical frame',
  (side) => {
    const vrm = greenFoxRig()
    const safety = new GeneratedBodySafety()
    safety.attach(vrm)
    const hand = vrm.humanoid.getNormalizedBoneNode(`${side}Hand`)
    if (!hand) throw new Error('Missing wrist')
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.8)
    safety.constrainTarget(hand, target)
    expect(target.angleTo(new THREE.Quaternion())).toBeLessThanOrEqual(0.551)
    expect(hand.quaternion.angleTo(new THREE.Quaternion())).toBe(0)
    vrm.scene.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
    })
  },
)

async function bodyFixture(
  vrm: VRM,
  isolateCoordinates = false,
  profileId: MotionProfileId = 'presence_warm',
  speechBound = false,
  rootDropM = 0,
  sourceArmEuler:
    | readonly [number, number, number]
    | ((frame: number) => readonly [number, number, number]) = [0, 0, 0],
) {
  const lease = {
    sessionId: 'real-bind',
    epoch: 1,
    modelGeneration: 1,
    avatarGeneration: 1,
    seed: 17,
  }
  const elbowAngle = isolateCoordinates ? 0.24 : Math.PI / 4
  const next: MotionApi['next'] = async (input) => ({
    ok: true,
    chunk: {
      ...input.lease,
      protocolVersion: 2,
      type: 'motion',
      id: 1,
      profileId: input.profileId,
      plan: input.plan,
      reset: input.fromFrame === 0,
      fromFrame: input.fromFrame ?? 0,
      startFrame: input.fromFrame ?? 0,
      fps: 30,
      skeleton: 'soma30-standard-tpose-v1',
      inferenceMs: 1,
      rotations: Array.from({ length: 60 }, (_, frame) => {
        const source =
          typeof sourceArmEuler === 'function'
            ? sourceArmEuler((input.fromFrame ?? 0) + frame)
            : sourceArmEuler
        return Array.from({ length: 30 }, (_, index) => {
          const rotation = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            [18, 19].includes(index) ? elbowAngle : [12, 13].includes(index) ? -elbowAngle : 0,
          )
          if ([17, 18, 19, 11, 12, 13].includes(index)) {
            const sign = index >= 17 ? 1 : -1
            rotation.premultiply(
              new THREE.Quaternion().setFromEuler(
                new THREE.Euler(
                  ...(source.map((angle) => angle * sign) as [number, number, number]),
                ),
              ),
            )
          }
          return rotation.toArray()
        })
      }),
      rootPositions: Array.from({ length: 60 }, () => [0, 0.9887084839474641 - rootDropM, 0]),
      footContacts: Array.from({ length: 60 }, () => ({
        leftHeel: 1,
        leftToe: 1,
        rightHeel: 1,
        rightToe: 1,
      })),
    },
  })
  vi.stubGlobal('window', {
    api: {
      motion: { start: async () => ({ ok: true, lease }), next, stop: async () => ({ ok: true }) },
    },
  })
  // Isolate the coordinate transfer; contact correctness is tested above on the same rig.
  if (isolateCoordinates) {
    vi.spyOn(GeneratedBodySafety.prototype, 'apply').mockImplementation(() => undefined)
    vi.spyOn(GeneratedBodySafety.prototype, 'constrainTarget').mockImplementation(() => undefined)
  }
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach(vrm)
  await owner.playProfile(profileId, {
    animationId: profileId,
    speechBound,
    behaviorId: 'fixture',
    source: 'debug-preview',
    reason: 'coordinate contract',
    previousAnimationId: null,
    blendDuration: 0.1,
    forceReplay: false,
    motionLayer: 'base',
  })
  return owner
}

it('retargets both SOMA30 forearms forward on the real VRM0 bind hierarchy', async () => {
  const vrm = greenFoxRig()
  vrm.scene.rotation.y = 1.1
  vrm.scene.updateMatrixWorld(true)
  const owner = await bodyFixture(vrm, true)
  for (let frame = 0; frame < 120; frame++) {
    owner.update(0.05, () => undefined)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
  }
  const inverse = vrm.scene.matrixWorld.clone().invert()
  for (const side of ['left', 'right'] as const) {
    const hand = vrm.humanoid.getNormalizedBoneNode(`${side}Hand`)
    const shoulder = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`)
    const elbow = vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`)
    if (!hand || !shoulder || !elbow) throw new Error('Missing real arm')
    const wrist = hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse)
    const origin = shoulder.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse)
    expect(wrist.z).toBeLessThan(origin.z - 0.04)
    expect(Math.abs(elbow.rotation.y)).toBeCloseTo(0.24, 3)
  }
  owner.detach()
  await owner.settleCancellation()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it('recovers to the calibrated admissible rest pose on the real rig', async () => {
  const vrm = greenFoxRig()
  const owner = await bodyFixture(vrm)
  const tick = async () => {
    owner.update(0.025, () => undefined)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
  }
  for (let frame = 0; frame < 200; frame++) await tick()
  owner.recover()
  for (let frame = 0; frame < 160 && !owner.getLibraryDebug().outcome; frame++) await tick()
  expect(
    owner.getLibraryDebug().outcome,
    JSON.stringify(owner.getBodyMotionDebugState().generated?.planning),
  ).toBe('superseded')
  expect(owner.getBodyMotionDebugState().generated?.safety?.unresolvedArmContacts).toBe(0)
  owner.detach()
  await owner.settleCancellation()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it.each([
  [-1.1, 1.3, -0.5],
  [1.1, -1.3, 0.5],
  [0.8, 1.1, 1.4],
  [-0.8, -1.1, -1.4],
  [1.5, 0.6, 0.2],
] as const)('returns from an admissible off-axis arm pose (%s, %s, %s)', (x, y, z) => {
  const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach(vrm)
  const safety = Reflect.get(owner, 'bodySafety') as GeneratedBodySafety
  const bones = ['rightUpperArm', 'rightLowerArm', 'rightHand'].map((name) => {
    const bone = vrm.humanoid.getNormalizedBoneNode(
      name as 'rightUpperArm' | 'rightLowerArm' | 'rightHand',
    )
    if (!bone) throw new Error('Missing arm')
    return bone
  })
  const rest = bones.map((bone) => bone.quaternion.clone())
  bones[0].quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)))
  bones[1].rotation.y = 1.4
  safety.apply()
  expect(safety.getDebugState().unresolvedArmContacts).toBe(0)
  safety.setHandTargets(undefined, 'recover')
  let lastStep = 0
  let maximumStep = 0
  let contacts = 0
  let reachedAt = -1
  for (let frame = 0; frame < 300; frame++) {
    const before = bones.map((bone) => bone.quaternion.clone())
    for (const [index, bone] of bones.entries()) bone.quaternion.copy(rest[index])
    safety.apply(1 / 60)
    lastStep = Math.max(...bones.map((bone, index) => bone.quaternion.angleTo(before[index])))
    maximumStep = Math.max(maximumStep, lastStep)
    contacts = Math.max(contacts, safety.getDebugState().unresolvedArmContacts ?? 0)
    if (reachedAt < 0 && bones.every((bone, index) => bone.quaternion.angleTo(rest[index]) < 0.06))
      reachedAt = frame + 1
  }
  expect(
    Math.max(...bones.map((bone, index) => bone.quaternion.angleTo(rest[index]))),
    JSON.stringify({
      lastStep,
      safety: safety.getDebugState(),
      errors: bones.map((bone, index) => bone.quaternion.angleTo(rest[index])),
    }),
  ).toBeLessThan(0.06)
  expect(maximumStep).toBeLessThanOrEqual(0.025001)
  expect(contacts).toBe(0)
  expect(reachedAt).toBeGreaterThan(0)
  expect(reachedAt * (1000 / 60)).toBeLessThanOrEqual(
    getMotionProfile('kiss_air_soft')?.phases.find((phase) => phase.id === 'recover')?.maxMs ?? 0,
  )
  owner.detach()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it.each([1 / 30, 0.1])(
  'finishes raised-hand recovery with %s second render intervals',
  async (delta) => {
    const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
    const owner = await bodyFixture(vrm, false, 'greet_wave_soft')
    for (let frame = 0; frame < 300 && owner.getLibraryDebug().phase !== 'hold'; frame++) {
      owner.update(1 / 60, () => undefined)
      for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    }
    expect(owner.getLibraryDebug().phase).toBe('hold')
    owner.recover()
    for (let frame = 0; frame < 160 && !owner.getLibraryDebug().outcome; frame++) {
      owner.update(delta, () => undefined)
      for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    }
    expect(
      owner.getLibraryDebug().outcome,
      JSON.stringify(owner.getBodyMotionDebugState().generated?.planning),
    ).toBe('superseded')
    expect(owner.getBodyMotionDebugState().generated?.safety?.unresolvedArmContacts).toBe(0)
    owner.detach()
    await owner.settleCancellation()
    vrm.scene.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
    })
  },
)

it('latches a motion failure when planted support cannot be recovered', async () => {
  const vrm = greenFoxRig()
  const owner = await bodyFixture(vrm)
  for (let frame = 0; frame < 160; frame++) {
    owner.update(1 / 60, () => undefined)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
  }
  owner.recover()
  vrm.scene.position.y += 10
  for (let frame = 0; frame < 200 && !owner.getLibraryDebug().outcome; frame++) {
    owner.update(1 / 30, () => undefined)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
  }
  expect(owner.getLibraryDebug().outcome).toBe('timed-out')
  expect(owner.getBodyMotionDebugState().generated?.error).toBe('ARDY_RECOVERY_TARGET_UNREACHED')
  owner.detach()
  await owner.settleCancellation()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it.each([
  [0, 0, 0],
  [0, 0.8, 0.5],
  [0.8, 0.3, 0.1],
  [-0.8, -0.3, -0.1],
  [1.2, -0.6, 0.4],
  [-1.2, 0.6, -0.4],
] as const)(
  'finishes face-to-front-to-rest motion without a contact trap (%s, %s, %s)',
  async (x, y, z) => {
    vi.stubGlobal('self', globalThis)
    const loader = new GLTFLoader()
    loader.register(() => ({
      name: 'geometry-only-recovery',
      loadTexture: async () => new THREE.Texture(),
    }))
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const bytes = readFileSync(
      process.env.SHIO_TEST_VRM_PATH ??
        new URL('../../../src/renderer/assets/vrm/green_fox.vrm', import.meta.url),
    )
    const gltf = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    )
    const vrm = gltf.userData.vrm as VRM
    VRMUtils.removeUnnecessaryJoints(vrm.scene)
    const owner = await bodyFixture(vrm, false, 'kiss_air_soft', false, 0, (frame) => [
      x * Math.sin(frame * 0.13),
      y * Math.sin(frame * 0.11),
      z * Math.sin(frame * 0.17),
    ])
    const chest = vrm.humanoid.getNormalizedBoneNode('chest')
    if (!chest) throw new Error('Missing chest')
    const restY = chest.position.y
    let contacts = 0
    for (let frame = 0; frame < 660 && !owner.getLibraryDebug().outcome; frame++) {
      owner.update(1 / 60, () => {
        chest.position.y = restY + 0.003 * Math.sin(frame * 0.02)
      })
      vrm.update(1 / 60)
      for (let turn = 0; turn < 8; turn++) await Promise.resolve()
      contacts = Math.max(
        contacts,
        owner.getBodyMotionDebugState().generated?.safety?.unresolvedArmContacts ?? 0,
      )
    }
    expect(
      owner.getLibraryDebug().outcome,
      JSON.stringify(owner.getBodyMotionDebugState().generated?.planning),
    ).toBe('completed')
    expect(contacts).toBe(0)
    owner.detach()
    await owner.settleCancellation()
    VRMUtils.deepDispose(vrm.scene)
  },
)

it('bounds wall time independently of a throttled recovery integration clock', async () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const vrm = greenFoxRig()
  const owner = await bodyFixture(vrm)
  for (let frame = 0; frame < 160; frame++) {
    owner.update(1 / 60, () => undefined)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
  }
  owner.recover()
  owner.update(1 / 60, () => undefined)
  expect(owner.getLibraryDebug().phase).toBe('recover')
  now = 11000
  owner.update(1 / 60, () => undefined)
  expect(owner.getLibraryDebug().outcome).toBe('timed-out')
  expect(owner.getBodyMotionDebugState().generated?.error).toBe('ARDY_RECOVERY_TARGET_UNREACHED')
  owner.detach()
  await owner.settleCancellation()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it('enters generated standing without a knee snap at the straight-leg singularity', async () => {
  const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
  const owner = await bodyFixture(vrm, false, 'presence_warm', false, 0.018)
  const knees = ['leftLowerLeg', 'rightLowerLeg'].map((name) =>
    vrm.humanoid.getNormalizedBoneNode(name as 'leftLowerLeg' | 'rightLowerLeg'),
  )
  let previous = knees.map((bone) => bone?.quaternion.clone() ?? new THREE.Quaternion())
  let maximumStep = 0
  for (let frame = 0; frame < 240; frame++) {
    if (frame === 120) owner.recover()
    owner.update(1 / 30, () => undefined)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    for (const [index, bone] of knees.entries())
      if (bone) maximumStep = Math.max(maximumStep, previous[index].angleTo(bone.quaternion))
    previous = knees.map((bone) => bone?.quaternion.clone() ?? new THREE.Quaternion())
  }
  expect(THREE.MathUtils.radToDeg(maximumStep)).toBeLessThanOrEqual(3)
  owner.detach()
  await owner.settleCancellation()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it('holds an actual constrained arm while consumed PCM is buffering', async () => {
  const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
  const owner = await bodyFixture(vrm, false, 'greet_wave_soft', true)
  const clock = {
    turnId: 'turn-1',
    playbackId: 'pcm-1',
    sourceSampleRate: 44100,
    sourceSampleOffset: 4410,
    state: 'playing' as const,
  }
  for (let frame = 1; frame <= 6; frame++) {
    owner.setClock({ ...clock, sourceSampleOffset: frame * 735 })
    owner.update(1 / 60, () => undefined)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
  }
  const bones = ['rightUpperArm', 'rightLowerArm', 'rightHand'] as const
  const before = bones.map((name) => vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.clone())
  owner.setClock({ ...clock, state: 'buffering' })
  for (let frame = 0; frame < 60; frame++) {
    owner.update(1 / 60, () => undefined)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
  }
  for (const [index, name] of bones.entries()) {
    const bone = vrm.humanoid.getNormalizedBoneNode(name)
    const prior = before[index]
    if (!bone || !prior) throw new Error('Missing constrained arm')
    expect(bone.quaternion.angleTo(prior)).toBeLessThan(0.00001)
  }
  owner.setClock({ ...clock, sourceSampleOffset: clock.sourceSampleOffset + 735 })
  owner.update(1 / 60, () => undefined)
  let resumedStep = 0
  for (const [index, name] of bones.entries()) {
    const bone = vrm.humanoid.getNormalizedBoneNode(name)
    const prior = before[index]
    if (!bone || !prior) throw new Error('Missing constrained arm')
    const step = bone.quaternion.angleTo(prior)
    expect(step).toBeLessThanOrEqual(0.026)
    resumedStep = Math.max(resumedStep, step)
  }
  expect(resumedStep).toBeGreaterThan(0.001)
  owner.detach()
  await owner.settleCancellation()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it('recovers root height at the same pace at 30 Hz and 360 Hz', async () => {
  const remaining = []
  for (const rate of [30, 360]) {
    const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
    const hips = vrm.humanoid.getNormalizedBoneNode('hips')
    if (!hips) throw new Error('Missing hips')
    const anchor = hips.position.y
    const owner = await bodyFixture(vrm, false, 'presence_warm', false, 0.018)
    const tick = async () => {
      owner.update(1 / rate, () => undefined)
      for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    }
    for (let frame = 0; frame < rate * 4; frame++) await tick()
    const initial = hips.position.y
    owner.recover()
    owner.update(0, () => undefined)
    for (let frame = 0; frame < rate * 0.3; frame++) await tick()
    remaining.push((hips.position.y - anchor) / (initial - anchor))
    owner.detach()
    await owner.settleCancellation()
    vrm.scene.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
    })
  }
  expect(Math.abs(remaining[0] - remaining[1])).toBeLessThan(0.01)
})

it('keeps actual body motion during breathing instead of freezing on the contact boundary', async () => {
  const vrm = greenFoxRig()
  const owner = await bodyFixture(vrm)
  const chest = vrm.humanoid.getNormalizedBoneNode('chest')
  const arm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
  if (!chest || !arm) throw new Error('Missing body')
  const restY = chest.position.y
  const initial = arm.quaternion.clone()
  let excursion = 0
  for (let frame = 0; frame < 300; frame++) {
    owner.update(1 / 60, () => {
      chest.position.y = restY + 0.008 * Math.sin(frame * 0.02)
    })
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    excursion = Math.max(excursion, initial.angleTo(arm.quaternion))
    expect(owner.getBodyMotionDebugState().generated?.safety?.unresolvedArmContacts).toBe(0)
  }
  expect(excursion).toBeGreaterThan(0.08)
  expect(excursion).toBeLessThanOrEqual(0.121)
  owner.detach()
  await owner.settleCancellation()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it('keeps contact correction continuous across a slowly changing neural arm target', () => {
  const vrm = greenFoxRig()
  const safety = new GeneratedBodySafety()
  safety.attach(vrm)
  const upper = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
  const lower = vrm.humanoid.getNormalizedBoneNode('rightLowerArm')
  if (!upper || !lower) throw new Error('Missing arm')
  upper.rotation.set(0, -0.4, -1)
  lower.rotation.y = 2.2
  safety.apply()
  let previous = upper.quaternion.clone()
  let maximum = 0
  for (let frame = 0; frame < 200; frame++) {
    upper.rotation.set(0, -0.4 + frame * 0.008, -1)
    lower.rotation.y = 2.2
    safety.apply(1 / 60)
    maximum = Math.max(maximum, previous.angleTo(upper.quaternion))
    previous = upper.quaternion.clone()
    expect(safety.getDebugState().unresolvedArmContacts).toBe(0)
  }
  expect(maximum).toBeLessThan(0.04)
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it('keeps a moving torso and clavicle from causing an unlimited arm repair', () => {
  const vrm = greenFoxRig()
  const safety = new GeneratedBodySafety()
  safety.attach(vrm)
  const bone = (name: Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0]) => {
    const value = vrm.humanoid.getNormalizedBoneNode(name)
    if (!value) throw new Error(`Missing ${name}`)
    return value
  }
  const upper = bone('leftUpperArm'),
    lower = bone('leftLowerArm')
  const shoulder = bone('leftShoulder'),
    chest = bone('chest')
  upper.rotation.set(0, 0.4, 1)
  lower.rotation.y = -2.2
  safety.apply()
  let previous = upper.quaternion.clone(),
    maximum = 0
  const initial = previous.clone()
  for (let frame = 0; frame < 240; frame++) {
    shoulder.rotation.set(0.2 * Math.sin(frame * 0.017), 0, 0.2 * Math.cos(frame * 0.017))
    chest.rotation.set(0.07 * Math.sin(frame * 0.02), 0.12 * Math.sin(frame * 0.016), 0)
    upper.rotation.set(0, 0.4 - frame * 0.008, 1)
    lower.rotation.y = -2.2
    vrm.scene.updateMatrixWorld(true)
    safety.apply(1 / 60)
    maximum = Math.max(maximum, previous.angleTo(upper.quaternion))
    previous = upper.quaternion.clone()
    expect(safety.getDebugState().unresolvedArmContacts).toBe(0)
  }
  expect(maximum).toBeLessThan(0.04)
  expect(initial.angleTo(upper.quaternion)).toBeGreaterThan(0.1)
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it.each([
  ['left', 0],
  ['right', 0],
  ['left', 1.1],
  ['right', 1.1],
] as const)('keeps the %s forearm out of the actual upper chest at model yaw %s', (side, yaw) => {
  const vrm = greenFoxRig()
  vrm.scene.rotation.y = yaw
  vrm.scene.updateMatrixWorld(true)
  const inverseModel = vrm.scene.matrixWorld.clone().invert()
  const safety = new GeneratedBodySafety()
  safety.attach(vrm)
  const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`)
  const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`)
  const hand = vrm.humanoid.getNormalizedBoneNode(`${side}Hand`)
  if (!upper || !lower || !hand) throw new Error('Bundled model is missing its arm chain')
  const sign = side === 'right' ? 1 : -1
  let crossings = 0
  for (const y of [-1.2, -0.6, 0, 0.6, 1.2]) {
    for (const z of [-1.8, -1.2, -0.6, 0, 0.6]) {
      for (const flex of [0.6, 1.2, 1.8, 2.4]) {
        upper.rotation.set(0, y * sign, z * sign)
        lower.rotation.set(0, flex * sign, 0)
        safety.apply()
        const elbow = lower.getWorldPosition(new THREE.Vector3())
        const wrist = hand.getWorldPosition(new THREE.Vector3())
        for (let step = 1; step <= 10; step++) {
          const point = elbow
            .clone()
            .lerp(wrist, step / 10)
            .applyMatrix4(inverseModel)
          // Interior chest volume in the actual rig, well beyond its former 5cm proxy.
          if (
            Math.abs(point.x) < 0.085 &&
            point.y > 1.29 &&
            point.y < 1.38 &&
            point.z < -0.035 &&
            point.z > -0.1
          )
            crossings++
        }
      }
    }
  }
  expect(crossings).toBe(0)
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})
