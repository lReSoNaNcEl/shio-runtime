import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { MotionPhaseExecution } from '../../../src/renderer/avatar/MotionPhaseExecution'
import type {
  AdaptiveMotionFilter,
  MotionFilterContext,
} from '../../../src/renderer/avatar/rendering/three/AdaptiveMotionFilter'
import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { getMotionProfile, type MotionLease } from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'
import { createMotionLease } from '../../support/avatar/motionFixtures'

describe('MotionBricks attainable rest variation', () => {
  it.each([0, 1])(
    'preserves selected forearm %s roll while the applied pose is still travelling',
    (side) => {
      const body = new GeneratedBodyPlayback(() => undefined)
      const rig = greenFoxRig()
      body.attach(rig)
      type Arm = {
        upper: THREE.Object3D
        lower: THREE.Object3D
        end: THREE.Object3D
        endRest: THREE.Quaternion
        palmAxis: THREE.Vector3
      }
      type Goal = {
        center: THREE.Vector3
        palm: THREE.Vector3 | null
        fingers: THREE.Vector3 | null
      }
      const safety = (
        body as unknown as {
          bodySafety: {
            sourceProvider: string
            arms: Arm[]
            workspaceSolutions: Map<
              Arm,
              { offset: THREE.Vector3; pole: number; forearmRoll?: number }
            >
            setHandTargets(profile: ReturnType<typeof getMotionProfile>, phase: 'prepare'): void
            handGoal(arm: Arm): Goal
            placeHand(arm: Arm, goal: Goal, point: THREE.Vector3, pole: number): void
          }
        }
      ).bodySafety
      try {
        safety.sourceProvider = 'motionbricks'
        safety.setHandTargets(getMotionProfile('explain_balance'), 'prepare')
        const arm = safety.arms[side]
        const goal = safety.handGoal(arm)
        const point = goal.center.clone()
        safety.placeHand(arm, { ...goal, palm: null }, point, 0.5)
        arm.end.quaternion.copy(arm.endRest)
        rig.scene.updateMatrixWorld(true)
        const forearm = arm.end
          .getWorldPosition(new THREE.Vector3())
          .sub(arm.lower.getWorldPosition(new THREE.Vector3()))
          .normalize()
        const current = arm.palmAxis
          .clone()
          .applyQuaternion(arm.end.getWorldQuaternion(new THREE.Quaternion()))
        current.addScaledVector(forearm, -current.dot(forearm)).normalize()
        const near = (angle: number) => current.clone().applyAxisAngle(forearm, angle)
        const apply = (palm: THREE.Vector3) => {
          safety.placeHand(arm, { ...goal, palm }, point, 0.5)
          return arm.lower.quaternion.clone()
        }
        const before = near(Math.PI - 0.001)
        const after = near(-Math.PI + 0.001)
        expect(before.angleTo(after)).toBeCloseTo(0.002, 6)
        const first = apply(before)
        expect(first.angleTo(apply(after))).toBeGreaterThan(2.5)
        safety.workspaceSolutions.set(arm, {
          offset: new THREE.Vector3(),
          pole: 0.5,
          forearmRoll: 1.3,
        })
        expect(apply(before).angleTo(apply(after))).toBeLessThan(0.001)
      } finally {
        body.detach()
      }
    },
  )
  it.each([
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 1],
  ] as const)(
    'keeps forearm %s target continuous across the angle cut from direction %s',
    (side, sign) => {
      const body = new GeneratedBodyPlayback(() => undefined)
      body.attach(greenFoxRig())
      type Arm = {
        upper: THREE.Object3D
        lower: THREE.Object3D
        end: THREE.Object3D
        hinge: THREE.Vector3
        flexAxis: THREE.Vector3
        rest: THREE.Quaternion
        sign: number
        twistLimit: number
      }
      const safety = (
        body as unknown as {
          bodySafety: {
            sourceProvider: string
            arms: Arm[]
            previousArms: Map<Arm, unknown>
            armPose(arm: Arm): { lower: THREE.Quaternion }
            constrainTarget(bone: THREE.Object3D, rotation: THREE.Quaternion): void
          }
        }
      ).bodySafety
      try {
        safety.sourceProvider = 'motionbricks'
        const arm = safety.arms[side]
        const pose = (twist: number) =>
          new THREE.Quaternion()
            .setFromAxisAngle(arm.hinge, arm.sign * 0.7)
            .multiply(new THREE.Quaternion().setFromAxisAngle(arm.flexAxis, twist))
            .multiply(arm.rest)
        const previous = safety.armPose(arm)
        previous.lower = pose(sign * 0.2)
        safety.previousArms.set(arm, previous)
        const before = pose(Math.PI - 0.001)
        const after = pose(-Math.PI + 0.001)
        expect(before.angleTo(after)).toBeCloseTo(0.002, 6)
        safety.constrainTarget(arm.lower, before)
        safety.constrainTarget(arm.lower, after)
        expect(before.angleTo(after)).toBeLessThan(0.001)
        expect(after.angleTo(pose(sign * arm.twistLimit))).toBeLessThan(1e-7)
        const admitted = pose(-sign * 1)
        safety.constrainTarget(arm.lower, admitted)
        expect(admitted.angleTo(pose(-sign * 1))).toBeLessThan(1e-7)
      } finally {
        body.detach()
      }
    },
  )
  it('seeds recovery from the displayed composition with procedural contributions applied once', () => {
    const body = new GeneratedBodyPlayback(() => undefined)
    const rig = greenFoxRig()
    body.attach(rig)
    const access = body as unknown as {
      lease: MotionLease | null
      appliedLease: MotionLease | null
      playing: boolean
      localRecovery: boolean
      appliedSourceProvider: string
      appliedExecutionId: string
      profileId: string
      appliedProfileId: string
      execution: MotionPhaseExecution
      recoveryPose: Map<THREE.Object3D, THREE.Quaternion>
      recoveryRoot: THREE.Vector3
      bindings: Array<{ name: string; bone: THREE.Object3D }>
      invalidatePhase(): void
    }
    const lease = createMotionLease()
    access.lease = lease
    access.appliedLease = lease
    try {
      const profile = getMotionProfile('presence_poised')
      if (!profile) throw new Error('Missing presence profile')
      access.execution = new MotionPhaseExecution('applied-recovery', profile)
      access.execution.phase = 'recover'
      access.execution.ready = true
      access.appliedExecutionId = access.execution.id
      access.profileId = profile.id
      access.appliedProfileId = profile.id
      access.appliedSourceProvider = 'motionbricks'
      access.playing = true
      access.localRecovery = true
      access.recoveryPose = new Map(
        access.bindings.map(({ bone }) => [bone, bone.quaternion.clone()]),
      )
      const arm = access.bindings.find((binding) => binding.name === 'rightUpperArm')?.bone
      const hips = rig.humanoid.getNormalizedBoneNode('hips')
      if (!arm || !hips) throw new Error('Missing real rig bone')
      access.recoveryPose.set(
        arm,
        arm.quaternion
          .clone()
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3)),
      )
      access.recoveryRoot.copy(hips.position)
      const procedural = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.05)
      const rootOffset = new THREE.Vector3(0, 0.001, 0)
      let calls = 0
      body.update(1 / 60, () => {
        calls++
        arm.quaternion.premultiply(procedural)
        hips.position.add(rootOffset)
      })
      expect(calls).toBe(1)
      const displayed = arm.quaternion.clone()
      const displayedRoot = hips.position.clone()
      access.invalidatePhase()
      const recovered = access.recoveryPose.get(arm)
      if (!recovered) throw new Error('Missing recovery origin')
      expect(procedural.clone().multiply(recovered).angleTo(displayed)).toBeLessThan(1e-7)
      expect(access.recoveryRoot.clone().add(rootOffset).distanceTo(displayedRoot)).toBeLessThan(
        1e-7,
      )
    } finally {
      access.lease = null
      access.appliedLease = null
      body.detach()
    }
  })
  it.each([0, 1])(
    'anchors hold hand %s to the applied pose while preserving unheld neural movement',
    (side) => {
      const body = new GeneratedBodyPlayback(() => undefined)
      body.attach(greenFoxRig())
      type Arm = { upper: THREE.Object3D; end: THREE.Object3D }
      type Goal = { center: THREE.Vector3; axes: THREE.Vector3[]; extents: number[] }
      const safety = (
        body as unknown as {
          bodySafety: {
            sourceProvider: string
            arms: Arm[]
            previousArms: Map<unknown, unknown>
            setHandTargets(
              profile: ReturnType<typeof getMotionProfile>,
              phase: 'prepare' | 'hold',
            ): void
            projectHandWorkspaces(): void
            handTargetsReached(): boolean
            handGoal(arm: Arm): Goal
            armPose(arm: Arm): { wristWorld?: THREE.Vector3 }
            placeHand(arm: Arm, goal: Goal, point: THREE.Vector3, pole: number): void
          }
        }
      ).bodySafety
      try {
        const profile = getMotionProfile('explain_balance')
        safety.sourceProvider = 'motionbricks'
        safety.setHandTargets(profile, 'prepare')
        safety.projectHandWorkspaces()
        expect(safety.handTargetsReached()).toBe(true)
        const arm = safety.arms[side]
        const applied = arm.end.getWorldPosition(new THREE.Vector3())
        const appliedPose = safety.armPose(arm)
        appliedPose.wristWorld = applied.clone()
        safety.previousArms.set(arm, appliedPose)
        safety.setHandTargets(profile, 'hold')
        const goal = safety.handGoal(arm)
        const other = goal.center.clone()
        for (const [index, value] of [0.9, -0.9, 0.9].entries())
          other.addScaledVector(goal.axes[index], value * goal.extents[index])
        safety.placeHand(arm, goal, other, 0)
        expect(safety.handTargetsReached()).toBe(true)
        expect(arm.end.getWorldPosition(new THREE.Vector3()).distanceTo(applied)).toBeGreaterThan(
          0.03,
        )
        safety.projectHandWorkspaces()
        expect(arm.end.getWorldPosition(new THREE.Vector3()).distanceTo(applied)).toBeLessThan(1e-5)
        safety.setHandTargets(profile, 'prepare')
        safety.placeHand(arm, goal, other, 0)
        safety.projectHandWorkspaces()
        expect(arm.end.getWorldPosition(new THREE.Vector3()).distanceTo(other)).toBeLessThan(1e-5)
      } finally {
        body.detach()
      }
    },
  )
  it.each([
    [0, 0],
    [1, 0],
    [0, 1.1],
    [1, 1.1],
  ] as const)('keeps elbow %s continuous across a collinear finger pole at yaw %s', (side, yaw) => {
    const body = new GeneratedBodyPlayback(() => undefined)
    const rig = greenFoxRig()
    rig.scene.rotation.y = yaw
    rig.scene.updateMatrixWorld(true)
    body.attach(rig)
    type Arm = { upper: THREE.Object3D; lower: THREE.Object3D; end: THREE.Object3D }
    type Pose = { upper: THREE.Quaternion; lower: THREE.Quaternion; end: THREE.Quaternion }
    const safety = (
      body as unknown as {
        bodySafety: {
          sourceProvider: string
          arms: Arm[]
          previousArms: Map<Arm, Pose>
          armPose(arm: Arm): Pose
          torso(): { front: THREE.Vector3; y: THREE.Vector3 }
          placeArm(arm: Arm, point: THREE.Vector3, pole: THREE.Vector3, a: number, b: number): void
        }
      }
    ).bodySafety
    try {
      safety.sourceProvider = 'motionbricks'
      const arm = safety.arms[side]
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
      const a = shoulder.distanceTo(arm.lower.getWorldPosition(new THREE.Vector3()))
      const b = arm.lower
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(arm.end.getWorldPosition(new THREE.Vector3()))
      const torso = safety.torso()
      const center = shoulder.clone().addScaledVector(torso.front, (a + b) * 0.65)
      const first = center.clone().addScaledVector(torso.y, 0.001)
      safety.placeArm(arm, first, first.clone().addScaledVector(torso.front, -b), a, b)
      const before = safety.armPose(arm)
      safety.previousArms.set(arm, before)
      const second = center.clone().addScaledVector(torso.y, -0.001)
      safety.placeArm(arm, second, second.clone().addScaledVector(torso.front, -b), a, b)
      expect(arm.upper.quaternion.angleTo(before.upper)).toBeLessThan(0.05)
      expect(arm.lower.quaternion.angleTo(before.lower)).toBeLessThan(0.05)
      safety.placeArm(arm, center, center.clone().addScaledVector(torso.front, -b), a, b)
      expect(arm.end.getWorldPosition(new THREE.Vector3()).distanceTo(center)).toBeLessThan(1e-5)
    } finally {
      body.detach()
    }
  })
  it('retains independent arm and wrist steps when the torso sweep clips the other arm', () => {
    const body = new GeneratedBodyPlayback(() => undefined)
    body.attach(greenFoxRig())
    const access = body as unknown as {
      bodySafety: {
        sourceProvider: string
        recovering: boolean
        arms: Array<{ upper: THREE.Object3D; lower: THREE.Object3D; end: THREE.Object3D }>
        torso(): { center: THREE.Vector3 }
        contact(arm: unknown, torso: unknown, padding: number): unknown
        sweepChain(dt: number, padding: number): void
      }
    }
    try {
      const safety = access.bodySafety
      safety.sourceProvider = 'motionbricks'
      safety.recovering = true
      const arm = safety.arms[0]
      const torso = safety.torso()
      const parent = arm.upper.parent
      if (!parent) throw new Error('Missing real rig parent')
      const direction = arm.lower.position.clone().applyQuaternion(arm.upper.quaternion).normalize()
      const towardTorso = torso.center
        .clone()
        .sub(arm.upper.getWorldPosition(new THREE.Vector3()))
        .applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert())
        .normalize()
      arm.upper.quaternion.premultiply(
        new THREE.Quaternion().setFromUnitVectors(direction, towardTorso),
      )
      arm.upper.updateMatrixWorld(true)
      expect(safety.contact(arm, torso, 0.003)).not.toBeNull()
      const wrist = arm.end.quaternion
        .clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.01))
      arm.end.quaternion.copy(wrist)
      const other = safety.arms[1]
      const independent = other.upper.quaternion
        .clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.001))
      other.upper.quaternion.copy(independent)
      safety.sweepChain(1 / 60, 0.003)
      expect(safety.contact(arm, safety.torso(), 0.003)).toBeNull()
      expect(safety.contact(other, safety.torso(), 0.003)).toBeNull()
      expect(other.upper.quaternion.angleTo(independent)).toBeLessThan(1e-7)
      // Wrist rotation does not move either endpoint of the tested arm capsule.
      expect(arm.end.quaternion.angleTo(wrist)).toBeLessThan(1e-7)
    } finally {
      body.detach()
    }
  })
  it.each(['motionbricks', 'ardy'] as const)(
    'preserves provider-scoped recovery context through the safety filter (%s)',
    (source) => {
      const body = new GeneratedBodyPlayback(() => undefined)
      body.attach(greenFoxRig())
      const access = body as unknown as {
        lease: MotionLease | null
        appliedLease: MotionLease | null
        playing: boolean
        localRecovery: boolean
        appliedSourceProvider: string
        appliedExecutionId: string
        execution: MotionPhaseExecution
        bodySafety: {
          temporalFilter: AdaptiveMotionFilter
          apply(dt: number, speed: number, advance: boolean, context: MotionFilterContext): void
        }
      }
      const lease = createMotionLease()
      access.lease = lease
      access.appliedLease = lease
      try {
        const profile = getMotionProfile('presence_poised')
        if (!profile) throw new Error('Missing presence profile')
        access.execution = new MotionPhaseExecution('presence-recovery', profile)
        access.execution.phase = 'recover'
        access.execution.elapsedMs = 400
        access.appliedExecutionId = access.execution.id
        access.playing = true
        access.localRecovery = true
        access.appliedSourceProvider = source
        const apply = vi.spyOn(access.bodySafety, 'apply')
        const filter = vi.spyOn(access.bodySafety.temporalFilter, 'step')
        body.validateFinalComposition(1 / 60)
        const expected = source === 'motionbricks' ? 0.5 : undefined
        expect(apply.mock.calls[0][3].reachSeconds).toBe(expected)
        const wrists = filter.mock.calls.filter(
          ([bone, , , , context]) => context.jointKinds?.get(bone) === 'wrist',
        )
        expect(wrists).toHaveLength(2)
        expect(wrists.every(([, , , , context]) => context.reachSeconds === expected)).toBe(true)
      } finally {
        access.lease = null
        access.appliedLease = null
        body.detach()
      }
    },
  )
  it.each([0.7, 1.6, 2.4])(
    'projects the recovered elbow target after a %s-rad articulated stroke',
    (flex) => {
      const body = new GeneratedBodyPlayback(() => undefined)
      body.attach(greenFoxRig())
      const access = body as unknown as {
        bindings: Array<{ name: string; bone: THREE.Object3D; safe: THREE.Quaternion }>
        bodySafety: {
          arms: Array<{
            lower: THREE.Object3D
            hinge: THREE.Vector3
            flexAxis: THREE.Vector3
            rest: THREE.Quaternion
          }>
          constrainTarget(bone: THREE.Object3D, rotation: THREE.Quaternion): void
        }
        execution: MotionPhaseExecution
        appliedSourceProvider: string
        invalidatePhase(): void
      }
      try {
        const profile = getMotionProfile('explain_point_close')
        if (!profile) throw new Error('Missing profile')
        const lower = access.bindings.find((binding) => binding.name === 'rightLowerArm')
        const arm = access.bodySafety.arms.find((candidate) => candidate.lower === lower?.bone)
        if (!lower || !arm) throw new Error('Missing elbow')
        // A valid composed flex/twist lives on the calibrated hinge manifold.
        // A quaternion chord toward it need not remain on that manifold.
        lower.bone.quaternion
          .setFromAxisAngle(arm.hinge, flex)
          .multiply(new THREE.Quaternion().setFromAxisAngle(arm.flexAxis, 1.2))
          .multiply(arm.rest)
        access.bodySafety.constrainTarget(lower.bone, lower.bone.quaternion)
        access.execution = new MotionPhaseExecution('rest-variation', profile)
        access.execution.phase = 'recover'
        access.appliedSourceProvider = 'motionbricks'
        access.invalidatePhase()
        const admitted = lower.safe.clone()
        access.bodySafety.constrainTarget(lower.bone, admitted)
        expect(lower.safe.angleTo(admitted)).toBeLessThan(1e-7)
      } finally {
        body.detach()
      }
    },
  )
})
