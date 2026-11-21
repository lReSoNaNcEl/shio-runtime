import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import type { MotionPhaseId, MotionProfile } from '../../../../shared/motion'
import {
  type MotionAttenuationChannel,
  type MotionAttenuationProbe,
  motionAttenuationChannel,
  NOOP_MOTION_ATTENUATION_PROBE,
} from '../../MotionAttenuation'
import {
  AdaptiveMotionFilter,
  type AdaptiveMotionFilterLimits,
  GENERATED_GESTURE_MAX_JOINT_SPEED,
  type MotionFilterContext,
} from './AdaptiveMotionFilter'
import { type HandGoal, type HandTarget, handWorkspaceGoal } from './BodyHandWorkspace'
import {
  type ArmPose,
  armPose,
  clamp,
  clearRecoveryPath,
  type Limb,
  measureTorso,
  penetrates,
  projectArm,
  projectWrist,
  slideArm,
  type Torso,
  torsoContact,
  wrap,
} from './BodyLimbGeometry'
import { type BodyClearanceCalibration, calibrateBodyClearance } from './GeneratedBodyCalibration'
import { WorkspaceTrajectory } from './WorkspaceTrajectory'

/** Bounded normalized-bone constraints, owned by the existing body composer. */
export class GeneratedBodySafety {
  private vrm: VRM | null = null
  private arms: Limb[] = []
  private legs: Limb[] = []
  private jointCorrections = 0
  private armCorrections = 0
  private unresolvedArmContacts = 0
  private clearance: BodyClearanceCalibration | null = null
  private previousArms = new Map<Limb, ArmPose>()
  private chain: THREE.Object3D[] = []
  private previousChain = new Map<THREE.Object3D, THREE.Quaternion>()
  private previousRoot: THREE.Vector3 | null = null
  private recovering = false
  private holding = false
  private holdAnchors = new Map<Limb, THREE.Vector3>()
  private handTargets: MotionProfile['handScore']['phases'][MotionPhaseId] | null = null
  private generatedSource = false
  private workspaceSolutions = new Map<
    Limb,
    { offset: THREE.Vector3; pole: number; extents?: number[]; forearmRoll?: number }
  >()
  private workspaceTrajectories = new Map<Limb, WorkspaceTrajectory>()
  private sourceHandPaths: ReadonlyMap<THREE.Object3D, readonly THREE.Vector3[]> = new Map()
  private readonly temporalFilter = new AdaptiveMotionFilter()
  private readonly jointKinds = new Map<THREE.Object3D, 'torso' | 'shoulder' | 'arm' | 'wrist'>()
  private readonly attenuationChannels = new Map<THREE.Object3D, MotionAttenuationChannel>()
  private attenuation: MotionAttenuationProbe = NOOP_MOTION_ATTENUATION_PROBE

  setAttenuationProbe(probe: MotionAttenuationProbe): void {
    this.attenuation = probe
    this.temporalFilter.setAttenuationProbe(probe, this.attenuationChannels)
  }

  attach(vrm: VRM): void {
    this.recovering = false
    this.reset()
    this.vrm = vrm
    vrm.scene.updateMatrixWorld(true)
    this.clearance = calibrateBodyClearance(vrm)
    const hips = vrm.humanoid.getNormalizedBoneNode('hips')
    const chest =
      vrm.humanoid.getNormalizedBoneNode('upperChest') ??
      vrm.humanoid.getNormalizedBoneNode('chest')
    const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')
    const right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
    const up =
      hips && chest
        ? chest
            .getWorldPosition(new THREE.Vector3())
            .sub(hips.getWorldPosition(new THREE.Vector3()))
            .normalize()
        : new THREE.Vector3(0, 1, 0)
    const across =
      left && right
        ? left
            .getWorldPosition(new THREE.Vector3())
            .sub(right.getWorldPosition(new THREE.Vector3()))
            .normalize()
        : new THREE.Vector3(vrm.meta.metaVersion === '0' ? -1 : 1, 0, 0)
    // Normalized VRM0 keeps left at -X; VRM1 keeps left at +X. The measured
    // shoulder basis already encodes this handedness, including scene rotation.
    const forward = across.cross(up).normalize()
    for (const side of ['left', 'right'] as const) {
      const hand = side === 'left' ? 1 : -1
      const make = (arm: boolean): Limb | null => {
        const upper = vrm.humanoid.getNormalizedBoneNode(`${side}${arm ? 'UpperArm' : 'UpperLeg'}`)
        const lower = vrm.humanoid.getNormalizedBoneNode(`${side}${arm ? 'LowerArm' : 'LowerLeg'}`)
        const end = vrm.humanoid.getNormalizedBoneNode(`${side}${arm ? 'Hand' : 'Foot'}`)
        if (!upper || !lower || !end || end.position.lengthSq() < 1e-8) return null
        const reference = lower.quaternion.clone()
        const flexAxis = arm ? lower.position.clone().normalize() : end.position.clone().normalize()
        const localForward = forward
          .clone()
          .applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()).invert())
        const hinge = arm
          ? flexAxis.clone().cross(localForward).normalize()
          : new THREE.Vector3(1, 0, 0)
        if (arm)
          reference.premultiply(
            new THREE.Quaternion().setFromUnitVectors(
              end.position.clone().applyQuaternion(reference).normalize(),
              flexAxis,
            ),
          )
        const worldHinge = hinge
          .clone()
          .applyQuaternion(lower.getWorldQuaternion(new THREE.Quaternion()))
        const worldAxis = end
          .getWorldPosition(new THREE.Vector3())
          .sub(lower.getWorldPosition(new THREE.Vector3()))
          .normalize()
        const desired = forward.clone().multiplyScalar(arm ? 1 : -1)
        const sign = arm
          ? 1
          : Math.sign(worldHinge.cross(worldAxis).dot(desired)) ||
            (arm ? -hand : vrm.meta.metaVersion === '0' ? -1 : 1)
        const fingerAxis =
          vrm.humanoid
            .getNormalizedBoneNode(`${side}MiddleProximal`)
            ?.position.clone()
            .normalize() ?? end.position.clone().normalize()
        const index = vrm.humanoid.getNormalizedBoneNode(`${side}IndexProximal`)?.position
        const little = vrm.humanoid.getNormalizedBoneNode(`${side}LittleProximal`)?.position
        const palmAxis =
          index && little ? index.clone().cross(little).normalize() : new THREE.Vector3(0, -1, 0)
        if (palmAxis.y > 0) palmAxis.negate()
        palmAxis.addScaledVector(fingerAxis, -palmAxis.dot(fingerAxis)).normalize()
        return {
          upper,
          lower,
          end,
          rest: reference,
          endRest: end.quaternion.clone(),
          axis: end.position.clone().normalize(),
          flexAxis,
          hinge,
          sign,
          side: hand,
          maximum: arm ? 2.65 : 2.45,
          twistLimit: arm ? 1.3 : 0.14,
          radius: arm
            ? (this.clearance?.forearmRadius?.[side] ?? this.clearance?.armRadius[side] ?? 0.025)
            : 0,
          upperRadius: arm ? (this.clearance?.armRadius[side] ?? 0.025) : 0,
          fingerAxis,
          palmAxis,
        }
      }
      const arm = make(true),
        leg = make(false)
      if (arm) this.arms.push(arm)
      if (leg) this.legs.push(leg)
    }
    this.chain = (
      [
        'hips',
        'spine',
        'chest',
        'upperChest',
        'leftShoulder',
        'rightShoulder',
        'leftUpperArm',
        'leftLowerArm',
        'leftHand',
        'rightUpperArm',
        'rightLowerArm',
        'rightHand',
      ] as const
    ).flatMap((name) => {
      const bone = vrm.humanoid.getNormalizedBoneNode(name)
      const channel = motionAttenuationChannel(name)
      if (bone && channel) this.attenuationChannels.set(bone, channel)
      if (bone)
        this.jointKinds.set(
          bone,
          /hips|spine|chest/iu.test(name)
            ? 'torso'
            : name.includes('Shoulder')
              ? 'shoulder'
              : name.includes('Hand')
                ? 'wrist'
                : 'arm',
        )
      return bone ? [bone] : []
    })
  }

  reset(): void {
    this.holding = false
    this.holdAnchors.clear()
    this.temporalFilter.reset()
    this.jointKinds.clear()
    this.attenuationChannels.clear()
    this.handTargets = null
    this.generatedSource = false
    this.workspaceSolutions.clear()
    this.workspaceTrajectories.clear()
    this.sourceHandPaths = new Map()
    this.vrm = null
    this.arms = []
    this.legs = []
    this.jointCorrections = 0
    this.armCorrections = 0
    this.unresolvedArmContacts = 0
    this.clearance = null
    this.previousArms.clear()
    this.chain = []
    this.previousChain.clear()
    this.previousRoot = null
  }

  getDebugState(): {
    jointCorrections: number
    armCorrections: number
    unresolvedArmContacts: number
  } {
    return {
      jointCorrections: this.jointCorrections,
      armCorrections: this.armCorrections,
      unresolvedArmContacts: this.unresolvedArmContacts,
    }
  }

  getFilterLimits(): AdaptiveMotionFilterLimits {
    return this.temporalFilter.getLimits()
  }

  /** Establish an admissible relaxed reference without solving into a raised gesture. */
  calibrateStandingPose(): void {
    const torso = this.torso()
    if (!torso) return
    for (const arm of this.arms) {
      if (!penetrates(arm, torso, 0.006)) continue
      const original = arm.upper.quaternion.clone()
      let lower = 0
      for (let sample = 1; sample <= 40; sample++) {
        let upper = sample / 40
        arm.upper.quaternion.copy(original).slerp(new THREE.Quaternion(), upper)
        arm.upper.updateMatrixWorld(true)
        if (penetrates(arm, torso, 0.006)) {
          lower = upper
          continue
        }
        for (let iteration = 0; iteration < 12; iteration++) {
          const middle = (lower + upper) / 2
          arm.upper.quaternion.copy(original).slerp(new THREE.Quaternion(), middle)
          arm.upper.updateMatrixWorld(true)
          if (penetrates(arm, torso, 0.006)) lower = middle
          else upper = middle
        }
        arm.upper.quaternion.copy(original).slerp(new THREE.Quaternion(), upper)
        arm.upper.updateMatrixWorld(true)
        break
      }
    }
    this.apply()
  }

  apply(delta = Infinity, speed = 1, advanceCandidate = true, motion?: MotionFilterContext): void {
    this.jointCorrections = 0
    this.armCorrections = 0
    this.unresolvedArmContacts = 0
    const vrm = this.vrm
    if (!vrm) return
    if ((motion?.generatedSource === true) !== this.generatedSource) {
      this.generatedSource = motion?.generatedSource === true
      this.workspaceTrajectories.clear()
      this.workspaceSolutions.clear()
      this.holdAnchors.clear()
    }
    if (!advanceCandidate)
      for (const bone of this.chain) {
        const previous = this.previousChain.get(bone)
        if (previous) bone.quaternion.copy(previous)
      }
    if (Number.isFinite(delta) && !motion) {
      for (const bone of this.chain) {
        if (this.arms.some((arm) => [arm.upper, arm.lower, arm.end].includes(bone))) continue
        const previous = this.previousChain.get(bone)
        if (previous) {
          const target = bone.quaternion.clone()
          bone.quaternion
            .copy(previous)
            .rotateTowards(target, speed * Math.max(0, Math.min(0.05, delta)))
        }
      }
    }
    // The held admissible arm is already composed. Reprojecting its temporal
    // interpolation every render tick would move it without consumed PCM.
    for (const limb of [...(advanceCandidate ? this.arms : []), ...this.legs])
      this.constrainHinge(limb)
    vrm.scene.updateMatrixWorld(true)
    if (advanceCandidate) this.projectHandWorkspacesAttributed()
    const torso = this.torso()
    if (!torso) return
    const repairedArms = new Set<Limb>()
    for (const arm of this.arms) {
      if (!penetrates(arm, torso, advanceCandidate ? 0.006 : 0)) continue
      this.armCorrections += 1
      repairedArms.add(arm)
      // A tangent contact needs an infinitesimal correction. Project the actual
      // limb segment before considering a different IK configuration.
      projectArm(arm, torso, 2, 0.006)
      if (!penetrates(arm, torso, 0.006)) continue
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
      const wrist = arm.end.getWorldPosition(new THREE.Vector3())
      const a = shoulder.distanceTo(arm.lower.getWorldPosition(new THREE.Vector3()))
      const b = arm.lower.getWorldPosition(new THREE.Vector3()).distanceTo(wrist)
      if (a < 0.001 || b < 0.001) continue
      const front = wrist.clone().sub(torso.center).dot(torso.front)
      const pole = shoulder
        .clone()
        .addScaledVector(torso.x, arm.side * a * 0.65)
        .addScaledVector(torso.front, a)
        .addScaledVector(torso.y, -a * 0.1)
      for (let attempt = 0; attempt < 4 && penetrates(arm, torso, 0.006); attempt += 1) {
        const target = wrist
          .clone()
          .addScaledVector(
            torso.front,
            Math.max(0, torso.radii.z - front) + torso.width * (0.12 + attempt * 0.12),
          )
        if (attempt === 3)
          target
            .copy(shoulder)
            .addScaledVector(torso.x, arm.side * (a + b) * 0.45)
            .addScaledVector(torso.front, (a + b) * 0.15)
            .addScaledVector(torso.y, -(a + b) * 0.72)
        this.placeArm(arm, target, pole, a, b)
      }
    }
    if (this.attenuation.active && advanceCandidate)
      for (const arm of this.arms)
        this.attenuation.report(
          'body-safety.contact',
          arm.side === 1 ? 'leftHand' : 'rightHand',
          1,
          repairedArms.has(arm) ? 0 : 1,
        )
    for (const arm of this.arms) {
      const previous = this.previousArms.get(arm)
      const before = arm.end.quaternion.clone()
      if (advanceCandidate || repairedArms.has(arm)) projectWrist(arm, arm.end.quaternion)
      if (before.angleTo(arm.end.quaternion) > 1e-5) this.jointCorrections += 1
      if (this.recovering && previous) this.routeRecoveryArm(arm, previous, torso)
      const target = this.armPose(arm)
      if (previous && Number.isFinite(delta) && !motion) {
        const step = speed * Math.max(0, Math.min(0.05, delta))
        const remaining = Math.max(
          previous.upper.angleTo(target.upper),
          previous.lower.angleTo(target.lower),
          previous.end.angleTo(target.end) / 1.5,
        )
        const fraction = remaining > 0 ? Math.min(1, step / remaining) : 1
        arm.upper.quaternion.copy(previous.upper).slerp(target.upper, fraction)
        arm.lower.quaternion.copy(previous.lower).slerp(target.lower, fraction)
        arm.end.quaternion.copy(previous.end).slerp(target.end, fraction)
        arm.upper.updateMatrixWorld(true)
        // Small moving-parent/breath contacts slide along the surface within
        // the remaining velocity budget; they never invoke an unlimited repair.
        if (penetrates(arm, torso, 0.003)) slideArm(arm, torso, step * 0.5)
      }
    }
    if (motion && !advanceCandidate) this.temporalFilter.hold()
    if (motion && advanceCandidate && Number.isFinite(delta)) {
      const context = { ...motion, jointKinds: this.jointKinds }
      const recoveringPresence =
        this.recovering && motion.generatedSource === true && motion.motionClass === 'presence'
      for (const bone of this.chain) {
        motion.onProjected?.(bone)
        const previous = this.previousChain.get(bone)
        if (previous) {
          const reaching = this.arms.some((arm) => {
            const target = this.handTargets?.[arm.side === 1 ? 'left' : 'right']
            return (
              target &&
              (target.workspace !== 'relaxed' || recoveringPresence) &&
              [arm.upper, arm.lower, arm.end].includes(bone)
            )
          })
          this.temporalFilter.step(bone, previous, bone.quaternion.clone(), delta, {
            ...context,
            reachSeconds: reaching ? motion.reachSeconds : undefined,
          })
        }
      }
    }
    if (motion) {
      for (const limb of [...this.arms, ...this.legs])
        this.projectHinge(limb, limb.lower.quaternion)
      for (const arm of this.arms) projectWrist(arm, arm.end.quaternion)
      if (motion.generatedSource === true && motion.motionClass !== 'presence')
        this.boundProjectedArmSteps(delta)
      for (const bone of this.chain) motion.onIntegrated?.(bone)
    }
    vrm.scene.updateMatrixWorld(true)
    if (motion?.motionClass === 'full-body' && this.previousRoot)
      this.previousRoot.copy(
        vrm.humanoid.getNormalizedBoneNode('hips')?.position ?? this.previousRoot,
      )
    this.sweepChain(
      delta,
      motion?.motionClass === 'gesture' || motion?.motionClass === 'reaction' ? 0.003 : 0,
    )
    if (motion && advanceCandidate)
      for (const bone of this.chain) {
        const previous = this.previousChain.get(bone)
        if (previous) this.temporalFilter.reconcile(bone, previous, delta)
      }
    for (const arm of this.arms) {
      const applied = this.armPose(arm)
      if (this.generatedSource) applied.wristWorld = arm.end.getWorldPosition(new THREE.Vector3())
      this.previousArms.set(arm, applied)
    }
    const finalTorso = this.torso()
    this.unresolvedArmContacts = finalTorso
      ? this.arms.filter((arm) => penetrates(arm, finalTorso)).length
      : 0
    this.previousChain = new Map(this.chain.map((bone) => [bone, bone.quaternion.clone()]))
    this.previousRoot = vrm.humanoid.getNormalizedBoneNode('hips')?.position.clone() ?? null
  }

  /** Anatomical projection is part of the one temporal constraint pass. A
   * hinge/twist boundary must not teleport an already integrated candidate. */
  private boundProjectedArmSteps(delta: number): void {
    const maximum = GENERATED_GESTURE_MAX_JOINT_SPEED * Math.max(0, Math.min(0.05, delta))
    for (const arm of this.arms) {
      for (const bone of [arm.upper, arm.lower, arm.end]) {
        const previous = this.previousChain.get(bone)
        if (!previous || previous.angleTo(bone.quaternion) <= maximum + 1e-9) continue
        const target = bone.quaternion.clone()
        let lower = 0,
          upper = 1
        const accepted = previous.clone()
        for (let i = 0; i < 14; i++) {
          const fraction = (lower + upper) / 2
          bone.quaternion.copy(previous).slerp(target, fraction)
          if (bone === arm.lower) this.projectHinge(arm, bone.quaternion)
          else if (bone === arm.end) projectWrist(arm, bone.quaternion)
          if (previous.angleTo(bone.quaternion) <= maximum) {
            lower = fraction
            accepted.copy(bone.quaternion)
          } else upper = fraction
        }
        bone.quaternion.copy(accepted)
      }
    }
  }

  setHandTargets(profile: MotionProfile | undefined, phase: MotionPhaseId): void {
    this.recovering = phase === 'recover'
    const targets = profile?.handScore.phases[phase] ?? null
    this.holding = phase === 'hold'
    if (!this.holding || targets !== this.handTargets) this.holdAnchors.clear()
    if (targets !== this.handTargets) this.workspaceTrajectories.clear()
    if (targets !== this.handTargets)
      for (const arm of this.arms) {
        const side = arm.side === 1 ? 'left' : 'right'
        const before = this.handTargets?.[side]
        const next = targets?.[side]
        if (
          before?.workspace !== next?.workspace ||
          before?.palmFacing !== next?.palmFacing ||
          before?.fingerDirection !== next?.fingerDirection
        )
          this.workspaceSolutions.delete(arm)
      }
    this.handTargets = targets
  }

  setSourceHandPaths(paths: ReadonlyMap<THREE.Object3D, readonly THREE.Vector3[]>): void {
    this.sourceHandPaths = paths
  }

  handTargetsReached(): boolean {
    for (const arm of this.arms) {
      const goal = this.handGoal(arm)
      if (!goal) {
        const target = this.handTargets?.[arm.side === 1 ? 'left' : 'right']
        if (target && target.workspace !== 'relaxed') return false
        continue
      }
      const wrist = arm.end.getWorldPosition(new THREE.Vector3())
      const error = wrist.clone().sub(goal.center)
      for (const [index, axis] of goal.axes.entries())
        if (Math.abs(error.dot(axis)) > goal.extents[index] + goal.length * 0.04) return false
      const world = arm.end.getWorldQuaternion(new THREE.Quaternion())
      if (goal.palm && arm.palmAxis.clone().applyQuaternion(world).dot(goal.palm) < 0.8)
        return false
      if (goal.fingers && arm.fingerAxis.clone().applyQuaternion(world).dot(goal.fingers) < 0.75)
        return false
    }
    return true
  }

  /** Prospective workspace samples only; never changes active constraints or pose. */
  expectedGesturePoints(profile: MotionProfile): THREE.Vector3[][] {
    return this.arms.flatMap((arm) => {
      const side = arm.side === 1 ? 'left' : 'right'
      const target = profile.handScore.phases.stroke[side]
      if (target.role === 'support' || target.workspace === 'relaxed') return []
      const goal = this.handGoal(arm, target)
      if (!goal) return []
      const tip = goal.center
        .clone()
        .addScaledVector(goal.fingers ?? goal.axes[1], goal.length * 0.25)
      const points = [goal.center, tip]
      for (const x of [-1, 1])
        for (const y of [-1, 1])
          for (const z of [-1, 1]) {
            const point = goal.center.clone()
            for (const [index, sign] of [x, y, z].entries())
              point.addScaledVector(goal.axes[index], sign * goal.extents[index])
            points.push(point)
          }
      return [points]
    })
  }

  private handGoal(
    arm: Limb,
    target: HandTarget | undefined = this.handTargets?.[arm.side === 1 ? 'left' : 'right'],
  ): HandGoal | null {
    return handWorkspaceGoal(this.vrm, this.torso(), arm, target, this.generatedSource)
  }

  /** Attribution reports the workspace pull of each wrist in arm lengths. */
  private projectHandWorkspacesAttributed(): void {
    if (!this.attenuation.active) {
      this.projectHandWorkspaces()
      return
    }
    const before = this.arms.map((arm) => arm.end.getWorldPosition(new THREE.Vector3()))
    this.projectHandWorkspaces()
    for (const [index, arm] of this.arms.entries()) {
      const length = arm.upper.getWorldPosition(new THREE.Vector3()).distanceTo(before[index]) || 1
      const moved = arm.end.getWorldPosition(new THREE.Vector3()).distanceTo(before[index])
      this.attenuation.report(
        'body-safety.workspace',
        arm.side === 1 ? 'leftHand' : 'rightHand',
        1,
        Math.max(0, 1 - moved / length),
      )
    }
  }

  private projectHandWorkspaces(): void {
    for (const arm of this.arms) {
      const goal = this.handGoal(arm)
      if (!goal) continue
      const wrist = arm.end.getWorldPosition(new THREE.Vector3())
      const offset = wrist.clone().sub(goal.center)
      const orientation = arm.end.getWorldQuaternion(new THREE.Quaternion())
      const withinWorkspace = goal.axes.every(
        (axis, index) => Math.abs(offset.dot(axis)) <= goal.extents[index],
      )
      const palmAdmitted =
        !goal.palm || arm.palmAxis.clone().applyQuaternion(orientation).dot(goal.palm) >= 0.8
      const fingersAdmitted =
        !goal.fingers ||
        arm.fingerAxis.clone().applyQuaternion(orientation).dot(goal.fingers) >= 0.75
      // A semantic workspace describes an admissible region, not a fixed IK
      // pose. Preserve the live source trajectory when it already satisfies it.
      const relative = this.handTargets?.[arm.side === 1 ? 'left' : 'right']?.workspaceTrajectory
      const holdApplied = this.generatedSource && this.holding && !relative
      if (!holdApplied && !relative && withinWorkspace && palmAdmitted && fingersAdmitted) continue
      let nearest = new THREE.Vector3(
        ...(goal.axes.map((axis, index) =>
          clamp(offset.dot(axis) / goal.extents[index], -0.9, 0.9),
        ) as [number, number, number]),
      )
      const previous = this.workspaceSolutions.get(arm)
      if (holdApplied) {
        let anchor = this.holdAnchors.get(arm)
        if (!anchor) {
          // Hold the admitted stroke's actually displayed hand, rather than
          // chasing a new autoregressive pose during the short hold budget.
          const applied = this.previousArms.get(arm)?.wristWorld ?? wrist
          const appliedOffset = applied.clone().sub(goal.center)
          anchor = new THREE.Vector3(
            ...(goal.axes.map((axis, index) =>
              clamp(appliedOffset.dot(axis) / goal.extents[index], -0.9, 0.9),
            ) as [number, number, number]),
          )
          this.holdAnchors.set(arm, anchor)
        }
        nearest = anchor.clone()
      }
      if (relative) {
        let trajectory = this.workspaceTrajectories.get(arm)
        if (!trajectory) {
          const start = previous?.offset.clone() ?? new THREE.Vector3()
          if (previous?.extents)
            for (let index = 0; index < 3; index++)
              start.setComponent(
                index,
                (start.getComponent(index) * previous.extents[index]) / goal.extents[index],
              )
          trajectory = new WorkspaceTrajectory(wrist.clone(), start, {
            displacements: this.sourceHandPaths.get(arm.end) ?? [],
            axes: goal.axes,
            extents: goal.extents,
          })
          this.workspaceTrajectories.set(arm, trajectory)
        }
        nearest = trajectory.sample(wrist, goal.axes, goal.extents)
      }
      const candidates = [
        { offset: nearest, pole: previous?.pole ?? 0.5 },
        ...(previous ? [previous] : []),
        { offset: new THREE.Vector3(), pole: 0.5 },
      ]
      for (const x of [-0.9, 0.9])
        for (const y of [-0.9, 0.9])
          for (const z of [-0.9, 0.9])
            for (const pole of [0, 0.5, 1, 2])
              candidates.push({ offset: new THREE.Vector3(x, y, z), pole })
      // A feasible palm basis can lie between box corners, especially near the
      // chest with a tilted clavicle. Keep the bounded search inside the box.
      for (const x of [-0.9, 0, 0.9])
        for (const y of [-0.9, 0, 0.9])
          for (const z of [-0.9, 0, 0.9])
            if ([x, y, z].filter((value) => value !== 0).length < 3)
              candidates.push({ offset: new THREE.Vector3(x, y, z), pole: 1 })
      let best = this.armPose(arm),
        bestScore = Infinity
      let solution = null
      const torso = this.torso()
      for (const candidate of candidates) {
        const requested = goal.center.clone()
        for (const [index, axis] of goal.axes.entries())
          requested.addScaledVector(
            axis,
            candidate.offset.getComponent(index) * goal.extents[index],
          )
        const forearmRoll = this.placeHand(arm, goal, requested, candidate.pole)
        const error = arm.end.getWorldPosition(new THREE.Vector3()).sub(goal.center)
        let positionError = 0
        for (const [index, axis] of goal.axes.entries())
          positionError +=
            Math.max(0, Math.abs(error.dot(axis)) - goal.extents[index]) / goal.length
        const rotation = arm.end.getWorldQuaternion(new THREE.Quaternion())
        const palmError = goal.palm
          ? 1 - arm.palmAxis.clone().applyQuaternion(rotation).dot(goal.palm)
          : 0
        const fingerError = goal.fingers
          ? 1 - arm.fingerAxis.clone().applyQuaternion(rotation).dot(goal.fingers)
          : 0
        const contact = torso ? penetrates(arm, torso, 0.008) : false
        const targetPose = this.armPose(arm)
        const previousPose = this.previousArms.get(arm)
        let blockedPath = false
        if (torso && previousPose) {
          arm.upper.quaternion.copy(previousPose.upper)
          arm.lower.quaternion.copy(previousPose.lower)
          arm.end.quaternion.copy(previousPose.end)
          arm.upper.updateMatrixWorld(true)
          const initialMetric = this.contact(arm, torso)?.metric ?? 1
          for (let sample = 1; sample <= 4; sample++) {
            arm.upper.quaternion.copy(previousPose.upper).slerp(targetPose.upper, sample / 4)
            arm.lower.quaternion.copy(previousPose.lower).slerp(targetPose.lower, sample / 4)
            arm.end.quaternion.copy(previousPose.end).slerp(targetPose.end, sample / 4)
            arm.upper.updateMatrixWorld(true)
            const along = this.contact(arm, torso)
            if (along && (initialMetric === 1 || along.metric < initialMetric - 1e-9)) {
              blockedPath = true
              break
            }
          }
          arm.upper.quaternion.copy(targetPose.upper)
          arm.lower.quaternion.copy(targetPose.lower)
          arm.end.quaternion.copy(targetPose.end)
          arm.upper.updateMatrixWorld(true)
        }
        const score =
          positionError * 20 +
          palmError +
          fingerError +
          (contact ? 5 : 0) +
          (blockedPath ? 3 : 0) +
          (palmError > 0.2 || fingerError > 0.25 ? 2 : 0) +
          (relative ? candidate.offset.distanceToSquared(nearest) * 0.04 : 0)
        if (score < bestScore) {
          bestScore = score
          best = this.armPose(arm)
          solution = { ...candidate, forearmRoll }
        }
        if (
          !contact &&
          !blockedPath &&
          positionError < 0.01 &&
          palmError < 0.15 &&
          fingerError < 0.2
        )
          break
      }
      arm.upper.quaternion.copy(best.upper)
      arm.lower.quaternion.copy(best.lower)
      arm.end.quaternion.copy(best.end)
      arm.upper.updateMatrixWorld(true)
      if (solution) this.workspaceSolutions.set(arm, { ...solution, extents: [...goal.extents] })
    }
  }

  private placeHand(
    arm: Limb,
    goal: HandGoal,
    requested: THREE.Vector3,
    poleFactor: number,
  ): number | undefined {
    const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
    const elbow = arm.lower.getWorldPosition(new THREE.Vector3())
    const wrist = arm.end.getWorldPosition(new THREE.Vector3())
    const a = shoulder.distanceTo(elbow),
      b = elbow.distanceTo(wrist)
    const pole = goal.fingers
      ? requested
          .clone()
          .addScaledVector(goal.fingers, -b)
          .addScaledVector(goal.axes[0], arm.side * a * poleFactor)
      : shoulder
          .clone()
          .addScaledVector(goal.axes[0], arm.side * a * (1 + poleFactor * 0.25))
          .addScaledVector(goal.axes[2], a * (0.5 + poleFactor))
          .addScaledVector(goal.axes[1], -a * 0.8)
    this.placeArm(arm, requested, pole, a, b)
    if (!goal.palm) return
    arm.end.quaternion.copy(arm.endRest)
    arm.end.updateMatrixWorld(true)
    // Forearm roll carries palm orientation before the bounded wrist refinement.
    const forearm = arm.end
      .getWorldPosition(new THREE.Vector3())
      .sub(arm.lower.getWorldPosition(new THREE.Vector3()))
      .normalize()
    const orientation = arm.end.getWorldQuaternion(new THREE.Quaternion())
    const current = arm.palmAxis
      .clone()
      .applyQuaternion(orientation)
      .addScaledVector(forearm, -arm.palmAxis.clone().applyQuaternion(orientation).dot(forearm))
      .normalize()
    const desired = goal.palm.clone().addScaledVector(forearm, -goal.palm.dot(forearm)).normalize()
    let forearmRoll = 0
    if (current.lengthSq() > 0.5 && desired.lengthSq() > 0.5) {
      let requestedRoll = Math.atan2(
        forearm.dot(current.clone().cross(desired)),
        current.dot(desired),
      )
      const previousRoll = this.generatedSource
        ? this.workspaceSolutions.get(arm)?.forearmRoll
        : undefined
      // The selected target precedes the acceleration-limited applied pose.
      // Preserve its angle branch while evaluating candidates; a wrapped
      // source roll must not demand a jump between opposite anatomical limits.
      if (previousRoll !== undefined)
        requestedRoll = previousRoll + wrap(requestedRoll - previousRoll)
      const angle = clamp(requestedRoll, -arm.twistLimit, arm.twistLimit)
      forearmRoll = angle
      arm.lower.quaternion
        .multiply(new THREE.Quaternion().setFromAxisAngle(arm.axis, angle))
        .normalize()
      arm.lower.updateMatrixWorld(true)
    }
    const fingers = goal.fingers ?? arm.fingerAxis.clone().applyQuaternion(orientation)
    const normal = goal.palm.clone().addScaledVector(fingers, -goal.palm.dot(fingers)).normalize()
    const local = new THREE.Matrix4().makeBasis(
      arm.fingerAxis,
      arm.palmAxis,
      arm.fingerAxis.clone().cross(arm.palmAxis).normalize(),
    )
    const world = new THREE.Matrix4().makeBasis(
      fingers,
      normal,
      fingers.clone().cross(normal).normalize(),
    )
    const target = new THREE.Quaternion().setFromRotationMatrix(world.multiply(local.invert()))
    const parent =
      arm.end.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
    arm.end.quaternion.copy(parent.invert().multiply(target)).normalize()
    projectWrist(arm, arm.end.quaternion)
    arm.end.updateMatrixWorld(true)
    return forearmRoll
  }

  private sweepChain(delta: number, clearance = 0): void {
    const hips = this.vrm?.humanoid.getNormalizedBoneNode('hips')
    if (!hips || !this.previousRoot || !this.previousChain.size || !Number.isFinite(delta)) return
    const candidate = new Map(this.chain.map((bone) => [bone, bone.quaternion.clone()]))
    const root = hips.position.clone()
    const set = (fraction: number): void => {
      for (const bone of this.chain) {
        // Wrist orientation moves neither endpoint of the tested arm capsule.
        // Its already projected/filtered recovery step must not inherit a
        // torso sweep's unrelated positional fraction and lose its velocity.
        if (this.generatedSource && this.recovering && this.jointKinds.get(bone) === 'wrist')
          continue
        const previous = this.previousChain.get(bone)
        const next = candidate.get(bone)
        if (previous && next) bone.quaternion.copy(previous).slerp(next, fraction)
      }
      if (this.previousRoot) hips.position.copy(this.previousRoot).lerp(root, fraction)
      this.vrm?.scene.updateMatrixWorld(true)
    }
    set(0)
    const initialTorso = this.torso()
    const initialMetrics = this.arms.map((arm) =>
      initialTorso ? (this.contact(arm, initialTorso, clearance)?.metric ?? 1) : 1,
    )
    const clear = (): boolean => {
      const torso = this.torso()
      return (
        !torso ||
        this.arms.every((arm, index) => {
          // Preserve the surface-sliding reserve across breathing/attachment
          // translations; an exact tangent is not a stable resting clearance.
          const contact = this.contact(arm, torso, clearance)
          if (!contact) return true
          // A moving attachment may invalidate the old pose by micrometres.
          // Permit bounded outward progress; never deepen an existing contact.
          return initialMetrics[index] < 1 && contact.metric >= initialMetrics[index] - 1e-9
        })
      )
    }
    let lower = 0,
      upper = 1
    // Check the path, including when the candidate lies beyond the body.
    for (let sample = 1; sample <= 4; sample++) {
      set(sample / 4)
      if (!clear()) {
        upper = sample / 4
        break
      }
      lower = sample / 4
    }
    if (lower < 1) {
      for (let iteration = 0; iteration < 12; iteration++) {
        const middle = (lower + upper) / 2
        set(middle)
        if (clear()) lower = middle
        else upper = middle
      }
      set(lower)
      if (this.generatedSource && this.recovering) {
        // One arm's contact must not freeze a separately admissible arm. Keep
        // the accepted root/torso, then sweep each limb's remaining bounded
        // step against both arms and the recomputed torso clearance.
        for (const arm of this.arms) {
          const joints = this.chain.filter(
            (bone) =>
              bone === arm.upper ||
              bone === arm.lower ||
              (bone === arm.upper.parent && this.jointKinds.get(bone) === 'shoulder'),
          )
          const accepted = new Map(joints.map((bone) => [bone, bone.quaternion.clone()]))
          const setArm = (fraction: number): void => {
            for (const bone of joints) {
              const from = accepted.get(bone)
              const to = candidate.get(bone)
              if (from && to) bone.quaternion.copy(from).slerp(to, fraction)
            }
            this.vrm?.scene.updateMatrixWorld(true)
          }
          let admitted = 0,
            rejected = 1
          for (let sample = 1; sample <= 4; sample++) {
            setArm(sample / 4)
            if (!clear()) {
              rejected = sample / 4
              break
            }
            admitted = sample / 4
          }
          if (admitted < 1) {
            for (let iteration = 0; iteration < 12; iteration++) {
              const middle = (admitted + rejected) / 2
              setArm(middle)
              if (clear()) admitted = middle
              else rejected = middle
            }
            setArm(admitted)
          }
        }
      }
    }
  }

  private routeRecoveryArm(arm: Limb, previous: ArmPose, torso: Torso): void {
    const desired = this.armPose(arm)
    if (clearRecoveryPath(arm, previous, desired, torso)) return
    const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
    const a = shoulder.distanceTo(arm.lower.getWorldPosition(new THREE.Vector3()))
    const b = arm.lower
      .getWorldPosition(new THREE.Vector3())
      .distanceTo(arm.end.getWorldPosition(new THREE.Vector3()))
    if (a < 0.001 || b < 0.001) return
    let best: ArmPose | null = null
    let bestCost = Infinity
    for (const [outward, forward, down] of [
      [0.65, 0.45, 0.25],
      [0.8, 0.25, 0.4],
      [0.65, -0.45, 0.25],
      [0.8, -0.25, 0.4],
      [0.75, 0, -0.3],
      [0.96, 0, 0],
    ]) {
      for (const poleFactor of [0, 0.5, 1, 2]) {
        arm.upper.quaternion.copy(desired.upper)
        arm.lower.quaternion.copy(desired.lower)
        arm.end.quaternion.copy(desired.end)
        arm.upper.updateMatrixWorld(true)
        const point = shoulder
          .clone()
          .addScaledVector(torso.x, arm.side * (a + b) * outward)
          .addScaledVector(torso.front, (a + b) * forward)
          .addScaledVector(torso.y, -(a + b) * down)
        const pole = shoulder
          .clone()
          .addScaledVector(torso.x, arm.side * a * (1 + poleFactor * 0.25))
          .addScaledVector(torso.front, a * (0.5 + poleFactor) * (forward < 0 ? -1 : 1))
          .addScaledVector(torso.y, -a * 0.8)
        this.placeArm(arm, point, pole, a, b)
        projectWrist(arm, arm.end.quaternion)
        const candidate = this.armPose(arm)
        if (
          penetrates(arm, torso, 0.006) ||
          !clearRecoveryPath(arm, previous, candidate, torso) ||
          !clearRecoveryPath(arm, candidate, desired, torso)
        )
          continue
        const cost =
          previous.upper.angleTo(candidate.upper) + previous.lower.angleTo(candidate.lower)
        if (cost < bestCost) {
          best = candidate
          bestCost = cost
        }
      }
    }
    const target = best ?? desired
    arm.upper.quaternion.copy(target.upper)
    arm.lower.quaternion.copy(target.lower)
    arm.end.quaternion.copy(target.end)
    arm.upper.updateMatrixWorld(true)
  }

  private torso(): Torso | null {
    return measureTorso(this.vrm, this.arms, this.clearance)
  }

  // Instance accessors kept for in-page qualification probes (close-candidates.cjs).
  private armPose(arm: Limb): ArmPose {
    return armPose(arm)
  }

  private contact(arm: Limb, torso: Torso, padding = 0) {
    return torsoContact(arm, torso, padding)
  }

  private constrainHinge(limb: Limb): void {
    const previous = limb.lower.quaternion.clone()
    this.projectHinge(limb, limb.lower.quaternion)
    if (previous.angleTo(limb.lower.quaternion) > 1e-5) this.jointCorrections += 1
    if (this.attenuation.active && this.arms.includes(limb))
      this.attenuation.report(
        'body-safety.hinge',
        limb.side === 1 ? 'leftHand' : 'rightHand',
        previous.angleTo(limb.rest),
        limb.lower.quaternion.angleTo(limb.rest),
      )
  }

  /** Project targets into the joint domain before temporal filtering. */
  constrainTarget(bone: THREE.Object3D, rotation: THREE.Quaternion): void {
    const limb = [...this.arms, ...this.legs].find((entry) => entry.lower === bone)
    if (limb) this.projectHinge(limb, rotation)
    const wrist = this.arms.find((entry) => entry.end === bone)
    if (wrist) projectWrist(wrist, rotation)
  }

  private projectHinge(limb: Limb, rotation: THREE.Quaternion): void {
    const delta = rotation.clone().multiply(limb.rest.clone().invert()).normalize()
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
    const projection = new THREE.Vector3(delta.x, delta.y, delta.z).dot(limb.flexAxis)
    const twist = new THREE.Quaternion(
      limb.flexAxis.x * projection,
      limb.flexAxis.y * projection,
      limb.flexAxis.z * projection,
      delta.w,
    )
    if (twist.lengthSq() < 1e-10) twist.identity()
    else twist.normalize()
    const swing = delta.clone().multiply(twist.clone().invert())
    const component = new THREE.Vector3(swing.x, swing.y, swing.z).dot(limb.hinge)
    const requestedFlex = limb.sign * wrap(2 * Math.atan2(component, swing.w))
    const flex =
      requestedFlex >= -0.02 && requestedFlex <= limb.maximum
        ? requestedFlex
        : Math.abs(wrap(requestedFlex - limb.maximum)) < Math.abs(wrap(requestedFlex + 0.02))
          ? limb.maximum
          : -0.02
    let requestedTwist = wrap(2 * Math.atan2(projection, delta.w))
    const previous = this.generatedSource ? this.previousArms.get(limb)?.lower : undefined
    if (previous) {
      const reference = previous.clone().multiply(limb.rest.clone().invert()).normalize()
      const component = new THREE.Vector3(reference.x, reference.y, reference.z).dot(limb.flexAxis)
      const appliedTwist = wrap(2 * Math.atan2(component, reference.w))
      // Equivalent source angles at +/-pi must not jump between opposite
      // anatomical limits. Unwrap around the applied joint before clamping;
      // every already admissible target and the temporal limits stay intact.
      requestedTwist = appliedTwist + wrap(requestedTwist - appliedTwist)
    }
    const twistAngle = clamp(requestedTwist, -limb.twistLimit, limb.twistLimit)
    rotation
      .setFromAxisAngle(limb.hinge, limb.sign * flex)
      .multiply(new THREE.Quaternion().setFromAxisAngle(limb.flexAxis, twistAngle))
      .multiply(limb.rest)
      .normalize()
  }

  private placeArm(
    arm: Limb,
    requested: THREE.Vector3,
    pole: THREE.Vector3,
    a: number,
    b: number,
  ): void {
    const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
    const direction = requested.clone().sub(shoulder)
    const distance = clamp(direction.length(), Math.abs(a - b) + 0.001, a + b - 0.001)
    if (direction.lengthSq() < 1e-8) return
    direction.normalize()
    const target = shoulder.clone().addScaledVector(direction, distance)
    const bend = pole
      .clone()
      .sub(shoulder)
      .addScaledVector(direction, -pole.clone().sub(shoulder).dot(direction))
    const previous = this.generatedSource ? this.previousArms.get(arm) : undefined
    if (previous) {
      const parent = arm.upper.parent
      const transported = arm.lower.position.clone().applyQuaternion(previous.upper)
      if (parent) transported.transformDirection(parent.matrixWorld)
      transported.addScaledVector(direction, -transported.dot(direction))
      if (transported.lengthSq() < 1e-8) {
        const normal = arm.hinge.clone().applyQuaternion(previous.upper)
        if (parent) normal.transformDirection(parent.matrixWorld)
        transported.copy(direction).cross(normal).multiplyScalar(arm.sign)
      }
      // A finger-aligned pole can cross the shoulder-to-hand line by only
      // millimetres and flip its elbow plane by pi. Parallel-transport the
      // applied plane through that singularity before temporal integration.
      if (bend.lengthSq() < 1e-8) bend.copy(transported)
      else if (bend.dot(transported) < 0) bend.negate()
    }
    if (bend.lengthSq() < 1e-8) return
    bend.normalize()
    const x = (a * a - b * b + distance * distance) / (2 * distance)
    const elbow = shoulder
      .clone()
      .addScaledVector(direction, x)
      .addScaledVector(bend, Math.sqrt(Math.max(0, a * a - x * x)))
    const upperDirection = elbow.clone().sub(shoulder).normalize()
    const lowerDirection = target.clone().sub(elbow).normalize()
    const normal = upperDirection.clone().cross(lowerDirection).normalize().multiplyScalar(arm.sign)
    const localX = arm.lower.position.clone().normalize()
    const localY = arm.hinge.clone().addScaledVector(localX, -arm.hinge.dot(localX)).normalize()
    const localZ = localX.clone().cross(localY).normalize()
    const worldZ = upperDirection.clone().cross(normal).normalize()
    const localBasis = new THREE.Matrix4().makeBasis(localX, localY, localZ)
    const worldBasis = new THREE.Matrix4().makeBasis(upperDirection, normal, worldZ)
    const world = new THREE.Quaternion().setFromRotationMatrix(
      worldBasis.multiply(localBasis.invert()),
    )
    const parent =
      arm.upper.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
    const orientation = arm.end.getWorldQuaternion(new THREE.Quaternion())
    arm.upper.quaternion.copy(parent.invert().multiply(world)).normalize()
    const flex = Math.acos(clamp((distance * distance - a * a - b * b) / (2 * a * b), -1, 1))
    const lowerAxis = arm.axis.clone()
    const lowerHinge = arm.hinge.clone().applyQuaternion(arm.rest.clone().invert()).normalize()
    const lowerBasis = new THREE.Matrix4().makeBasis(
      lowerAxis,
      lowerHinge,
      lowerAxis.clone().cross(lowerHinge).normalize(),
    )
    const lowerWorldBasis = new THREE.Matrix4().makeBasis(
      lowerDirection,
      normal,
      lowerDirection.clone().cross(normal).normalize(),
    )
    const lowerWorld = new THREE.Quaternion().setFromRotationMatrix(
      lowerWorldBasis.multiply(lowerBasis.invert()),
    )
    arm.lower.quaternion.copy(world.clone().invert().multiply(lowerWorld)).normalize()
    if (flex > arm.maximum) this.projectHinge(arm, arm.lower.quaternion)
    arm.upper.updateMatrixWorld(true)
    const handParent =
      arm.end.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
    arm.end.quaternion.copy(handParent.invert().multiply(orientation)).normalize()
    arm.end.updateMatrixWorld(true)
  }
}
