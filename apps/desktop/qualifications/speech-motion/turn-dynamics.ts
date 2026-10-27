import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import * as THREE from 'three'

import { MotionPhaseExecution } from '../../src/renderer/avatar/MotionPhaseExecution'
import { GeneratedBodyPlayback } from '../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { TurnInPlaceMotion } from '../../src/renderer/avatar/rendering/three/TurnInPlaceMotion'
import { getMotionProfile } from '../../src/shared/motion'
import { greenFoxRig } from '../../tests/support/avatar/greenFoxRig'

const option = (name: string) =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3)
const filename = path.resolve(
  option('output') ?? 'apps/desktop/motion/.artifacts/living-motion/turn-dynamics.json',
)
const vrmPath = path.resolve(option('vrm') ?? 'apps/desktop/src/renderer/assets/vrm/green_fox.vrm')
const profile = getMotionProfile('turn_in_place')
if (!profile) throw new Error('Missing canonical turn profile')
const names = [
  'hips',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
] as const
type JointName = (typeof names)[number]
interface Frame {
  at: number
  phase: string
  heading: number
  support: string
  root: number[] | undefined
  joints: Partial<Record<JointName, number[] | undefined>>
  feet: (number[] | undefined)[]
}
const cases = []
for (const cadence of ['60', 'variable'] as const) {
  const vrm = greenFoxRig(vrmPath)
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach(vrm)
  const plan = new TurnInPlaceMotion(
    vrm,
    {
      action: 'turn-in-place',
      turns: 1,
      direction: option('direction') === 'counterclockwise' ? 'counterclockwise' : 'clockwise',
      tempo: Number(option('tempo') ?? 1),
      finishFacing: 'viewer',
    },
    17,
  )
  const state = owner as unknown as {
    turn: TurnInPlaceMotion
    playing: boolean
    started: boolean
    profileId: string
    execution: MotionPhaseExecution
    transitionPose: Map<THREE.Object3D, THREE.Quaternion>
    presentationBones: Array<[string, THREE.Object3D]>
  }
  state.turn = plan
  state.playing = state.started = true
  state.profileId = profile.id
  state.execution = new MotionPhaseExecution('turn-dynamics', profile)
  state.transitionPose = new Map(
    state.presentationBones.map(([, bone]) => [bone, bone.quaternion.clone()]),
  )
  const frames: Frame[] = []
  let firstFailure: unknown = null
  let at = 0
  for (let index = 0; index < 1800 && !plan.outcome; index++) {
    const delta = cadence === '60' ? 1 / 60 : [1 / 144, 1 / 90, 1 / 40, 1 / 60, 1 / 120][index % 5]
    at += delta
    if (at >= Number(option('stop-at') ?? Infinity)) plan.requestStop()
    owner.update(delta, () => undefined)
    vrm.humanoid.update()
    vrm.scene.updateMatrixWorld(true)
    const internal = plan as unknown as {
      failed: boolean
      balanceMargin: number
      recovering: boolean
    }
    if (internal.failed && !firstFailure)
      firstFailure = {
        at,
        balanceMargin: internal.balanceMargin,
        recovering: internal.recovering,
        errors: plan.feet.map((leg) =>
          leg.foot.getWorldPosition(new THREE.Vector3()).distanceTo(leg.target),
        ),
        angles: plan.feet.map((leg) =>
          leg.foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(leg.orientation),
        ),
      }
    frames.push({
      at,
      phase: plan.phase,
      heading: plan.heading,
      support: plan.getStatus().support,
      root: vrm.humanoid.getRawBoneNode('hips')?.getWorldPosition(new THREE.Vector3()).toArray(),
      joints: Object.fromEntries(
        names.map((name) => [name, vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.toArray()]),
      ),
      feet: ['leftFoot', 'rightFoot'].map((name) =>
        vrm.humanoid
          .getRawBoneNode(name as 'leftFoot' | 'rightFoot')
          ?.getWorldPosition(new THREE.Vector3())
          .toArray(),
      ),
    })
  }
  const peaks = Object.fromEntries(
    names.map((name) => {
      let velocity = new THREE.Vector3(),
        acceleration = new THREE.Vector3(),
        speedMax = 0,
        accelerationMax = 0,
        jerkMax = 0,
        peakAt = 0,
        previousDt = 0,
        previousAccelerationDt = 0
      for (let index = 1; index < frames.length; index++) {
        const previous = frames[index - 1].joints[name],
          current = frames[index].joints[name]
        if (!previous || !current) continue
        const dt = frames[index].at - frames[index - 1].at
        const q = new THREE.Quaternion()
          .fromArray(current)
          .multiply(new THREE.Quaternion().fromArray(previous).invert())
          .normalize()
        if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
        const axis = new THREE.Vector3(q.x, q.y, q.z)
        const v = axis
          .clone()
          .normalize()
          .multiplyScalar((2 * Math.atan2(axis.length(), q.w)) / dt)
        const accelerationDt = (dt + (previousDt || dt)) / 2
        const a = v.clone().sub(velocity).divideScalar(accelerationDt)
        const jerk =
          a.clone().sub(acceleration).length() /
          ((accelerationDt + (previousAccelerationDt || accelerationDt)) / 2)
        speedMax = Math.max(speedMax, v.length())
        accelerationMax = Math.max(accelerationMax, a.length())
        if (jerk > jerkMax) {
          jerkMax = jerk
          peakAt = frames[index].at
        }
        velocity = v
        acceleration = a
        previousDt = dt
        previousAccelerationDt = accelerationDt
      }
      return [name, { speedMax, accelerationMax, jerkMax, peakAt }]
    }),
  )
  const internals = plan as unknown as {
    failed: boolean
    interrupt: string | null
    recovering: boolean
    goal: number
    balanceMargin: number
  }
  cases.push({
    cadence,
    outcome: plan.outcome,
    status: plan.getStatus(),
    firstFailure,
    internals: {
      failed: internals.failed,
      interrupt: internals.interrupt,
      recovering: internals.recovering,
      goal: internals.goal,
      balanceMargin: internals.balanceMargin,
    },
    planner: {
      candidates: plan.planner.candidatesEvaluated,
      selected: plan.planner.plansSelected,
      rejected: plan.planner.rejected,
      legs: plan.planner.legs,
    },
    peaks,
    frames,
  })
}
mkdirSync(path.dirname(filename), { recursive: true })
writeFileSync(filename, JSON.stringify({ cases }, null, 2))
console.log(JSON.stringify(cases.map(({ frames, ...summary }) => summary)))
