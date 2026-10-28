import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import { ProceduralMotionController } from '../../src/renderer/avatar/embodiment/motion/ProceduralMotionController'
import { MotionPhaseExecution } from '../../src/renderer/avatar/MotionPhaseExecution'
import { GeneratedBodyPlayback } from '../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { GeneratedBodySafety } from '../../src/renderer/avatar/rendering/three/GeneratedBodySafety'
import type { MotionDynamicsSample } from '../../src/renderer/avatar/rendering/three/MotionDynamicsObserver'
import { plantLeg } from '../../src/renderer/avatar/rendering/three/plantLeg'
import {
  getMotionProfile,
  type MotionChunk,
  type MotionPhaseId,
  motionChunkSchema,
} from '../../src/shared/motion'
import { greenFoxRig } from '../../tests/support/avatar/greenFoxRig'

const option = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.split('=')[1]
const sourceFile = path.resolve(option('source') ?? '')
const output = path.resolve(option('output') ?? path.join(path.dirname(sourceFile), 'baseline'))
const model = path.resolve(option('vrm') ?? 'src/renderer/assets/vrm/green_fox.vrm')
const proceduralMode = option('procedural') ?? 'none'
const trackingPolicy = option('tracking-policy') ?? 'source'
if (!['source', 'previous'].includes(trackingPolicy)) throw new Error('Unknown tracking policy')
if (!['none', 'breathing', 'micro', 'full'].includes(proceduralMode))
  throw new Error('Unknown procedural diagnostic mode')
const source = JSON.parse(readFileSync(sourceFile, 'utf8')) as {
  seed: number
  pins: unknown
  cases: Array<{ profileId: string; chunks: Array<MotionChunk & { phase: MotionPhaseId }> }>
}
const lease = {
  sessionId: 'qualification',
  epoch: 1,
  modelGeneration: 1,
  avatarGeneration: 1,
  seed: source.seed,
}
const samples: Array<MotionDynamicsSample & { profileId: string }> = []
const summary: unknown[] = []

// Test-side access only: replay invokes the exact production retarget/composition
// without inference scheduling or inventing a second implementation of its filters.
interface ReplayAccess {
  playing: boolean
  profileId: string
  cursor: number
  queue: MotionChunk[]
  execution: MotionPhaseExecution
  apply(chunk: MotionChunk, delta: number, progress: number): void
}
function planted(vrm: VRM) {
  return (['left', 'right'] as const).map((side) => {
    const bone = (part: 'UpperLeg' | 'LowerLeg' | 'Foot') => {
      const result = vrm.humanoid.getNormalizedBoneNode(`${side}${part}`)
      if (!result) throw new Error('Qualification requires both legs')
      return result
    }
    const upper = bone('UpperLeg'),
      lower = bone('LowerLeg'),
      foot = bone('Foot')
    return {
      upper,
      lower,
      foot,
      target: foot.getWorldPosition(new THREE.Vector3()),
      orientation: foot.getWorldQuaternion(new THREE.Quaternion()),
      pole: new THREE.Vector3(0, 0, vrm.meta.metaVersion === '0' ? -1 : 1),
    }
  })
}
function metrics(values: MotionDynamicsSample[]) {
  const q = values.map((v) => new THREE.Quaternion().fromArray(v.rotation))
  const velocity: THREE.Vector3[] = []
  const acceleration: THREE.Vector3[] = []
  const jerk: number[] = []
  for (let i = 1; i < q.length; i++) {
    const delta = q[i - 1].clone().invert().multiply(q[i]).normalize()
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
    const dt = (values[i].sourceFrame - values[i - 1].sourceFrame) / 30
    const axis = new THREE.Vector3(delta.x, delta.y, delta.z)
    const angle = 2 * Math.atan2(axis.length(), delta.w)
    const speed = axis.normalize().multiplyScalar(angle / dt)
    velocity.push(speed)
    if (i >= 2) {
      const a = speed
        .clone()
        .sub(velocity[i - 2])
        .divideScalar(dt)
      acceleration.push(a)
      if (i >= 3)
        jerk.push(
          a
            .clone()
            .sub(acceleration[i - 3])
            .length() / dt,
        )
    }
  }
  const speeds = velocity.map((v) => v.length())
  const peak = Math.max(0, ...speeds)
  return {
    peakRadS: peak,
    meanRadS: speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length),
    peakAccelerationRadS2: Math.max(0, ...acceleration.map((v) => v.length())),
    peakJerkRadS3: Math.max(0, ...jerk),
    amplitudeRad: Math.max(0, ...q.map((v) => q[0].angleTo(v))),
    strokeDurationMs: speeds.filter((v) => v > peak * 0.5).length * (1000 / 60),
  }
}
function tracking(targets: MotionDynamicsSample[], final: MotionDynamicsSample[]) {
  let best = Infinity,
    lag = 0
  for (let shift = 0; shift <= 60; shift++) {
    let error = 0,
      count = 0
    for (let i = 30; i + shift < final.length; i++) {
      error +=
        new THREE.Quaternion()
          .fromArray(targets[i].rotation)
          .angleTo(new THREE.Quaternion().fromArray(final[i + shift].rotation)) ** 2
      count++
    }
    error /= Math.max(1, count)
    if (error < best) {
      best = error
      lag = shift * (1000 / 60)
    }
  }
  const errors = targets.map((v, i) =>
    new THREE.Quaternion()
      .fromArray(v.rotation)
      .angleTo(new THREE.Quaternion().fromArray(final[i].rotation)),
  )
  return {
    lagMs: Math.sqrt(best) < 0.15 ? lag : null,
    bestLagCandidateMs: lag,
    alignedRmsErrorRad: Math.sqrt(best),
    rmsErrorRad: Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length),
  }
}
for (const entry of source.cases) {
  const profile = getMotionProfile(entry.profileId)
  if (!profile) throw new Error('Unknown captured profile')
  const vrm = greenFoxRig(model)
  let frameSamples: MotionDynamicsSample[] = []
  const owner = new GeneratedBodyPlayback(
    () => undefined,
    (sample) => {
      frameSamples.push(sample)
      samples.push({ ...sample, profileId: profile.id })
    },
  )
  owner.attach(vrm)
  const procedural = new ProceduralMotionController()
  procedural.attach(vrm)
  const replay = owner as unknown as ReplayAccess
  replay.playing = true
  replay.profileId = profile.id
  replay.execution = new MotionPhaseExecution(`replay-${profile.id}`, profile)
  const physicalRig = greenFoxRig(model)
  const initializer = new GeneratedBodyPlayback(() => undefined)
  initializer.attach(physicalRig)
  const physicalSafety = new GeneratedBodySafety()
  physicalSafety.attach(physicalRig)
  const feet = planted(physicalRig)
  const wristRigs = Object.fromEntries(
    ['artistic', 'admissible', 'final'].map((stage) => [stage, greenFoxRig(model)]),
  )
  const wristPoints: Record<string, Array<{ frame: number; point: THREE.Vector3 }>> = {}
  const chunks = entry.chunks.map((captured, index) => {
    const { phase, ...data } = captured
    const execution = replay.execution
    execution.phase = phase
    return motionChunkSchema.parse({
      ...data,
      sourceProvider: trackingPolicy === 'previous' ? undefined : data.sourceProvider,
      ...lease,
      type: 'motion',
      id: index,
      reset: index === 0,
      fromFrame: captured.startFrame,
      protocolVersion: 2,
      profileId: profile.id,
      plan: execution.plan('qualification'),
    })
  })
  replay.queue = chunks
  let corrections = 0,
    contacts = 0
  const timings: Array<{ retargetMs: number; finalSafetyMs: number }> = []
  const started = performance.now()
  for (const [index, chunk] of chunks.entries()) {
    replay.execution.phase = entry.chunks[index].phase
    for (let step = 0; step < 120; step++) {
      frameSamples = []
      replay.cursor = chunk.startFrame + step / 2
      const retargetAt = performance.now()
      procedural.remove()
      replay.apply(chunk, 1 / 60, step / 120)
      if (proceduralMode === 'full') procedural.update(1 / 60)
      else if (proceduralMode !== 'none') {
        const channel = Reflect.get(
          procedural,
          proceduralMode === 'breathing' ? 'breath' : 'microMotion',
        ) as { update(seconds: number): void }
        channel.update(1 / 60)
      }
      const safetyAt = performance.now()
      owner.validateFinalComposition(1 / 60)
      for (const [stage, rig] of Object.entries(wristRigs)) {
        for (const sample of frameSamples.filter((value) => value.stage === stage))
          rig.humanoid.getNormalizedBoneNode(sample.bone)?.quaternion.fromArray(sample.rotation)
        rig.scene.updateMatrixWorld(true)
        for (const side of ['left', 'right'] as const) {
          const hand = rig.humanoid.getNormalizedBoneNode(`${side}Hand`)
          if (hand) {
            const key = `${stage}:${side}`
            wristPoints[key] ??= []
            wristPoints[key].push({
              frame: replay.cursor,
              point: hand.getWorldPosition(new THREE.Vector3()),
            })
          }
        }
      }
      timings.push({
        retargetMs: safetyAt - retargetAt,
        finalSafetyMs: performance.now() - safetyAt,
      })
      for (const sample of frameSamples.filter((v) => v.stage === 'anatomical'))
        physicalRig.humanoid
          .getNormalizedBoneNode(sample.bone)
          ?.quaternion.fromArray(sample.rotation)
      physicalRig.scene.updateMatrixWorld(true)
      physicalSafety.apply(Infinity)
      for (const leg of feet)
        plantLeg(leg.upper, leg.lower, leg.foot, leg.target, leg.orientation, leg.pole)
      for (const sample of frameSamples.filter((v) => v.stage === 'anatomical')) {
        const bone = physicalRig.humanoid.getNormalizedBoneNode(sample.bone)
        if (bone)
          samples.push({
            ...sample,
            profileId: profile.id,
            stage: 'anatomical',
            rotation: bone.quaternion.toArray(),
          })
      }
      const state = owner.getBodyMotionDebugState().generated.safety
      corrections += state?.armCorrections ?? 0
      contacts = Math.max(contacts, state?.unresolvedArmContacts ?? 0)
    }
  }
  const selected = samples.filter((v) => v.profileId === profile.id)
  const boneReports = [...new Set(selected.map((v) => v.bone))].map((bone) => {
    const byStage = Object.fromEntries(
      [
        'source',
        'retargeted',
        'anatomical',
        'artistic',
        'admissible',
        'temporal',
        'transition',
        'final',
      ].map((stage) => [
        stage,
        selected
          .filter((v) => v.bone === bone && v.stage === stage)
          // Anatomical observations are followed by the independent contact projection.
          .filter((_, i) => stage !== 'anatomical' || i % 2 === 1),
      ]),
    )
    return {
      bone,
      stages: Object.fromEntries(
        Object.entries(byStage).map(([name, values]) => [name, metrics(values)]),
      ),
      strokeStages: Object.fromEntries(
        Object.entries(byStage).map(([name, values]) => [
          name,
          metrics(values.filter((v) => v.sourceFrame >= 60 && v.sourceFrame < 120)),
        ]),
      ),
      tracking: tracking(byStage.artistic, byStage.final),
      admissibleTracking: byStage.admissible.length
        ? tracking(byStage.admissible, byStage.final)
        : null,
    }
  })
  summary.push({
    profileId: profile.id,
    samples: chunks.length * 120,
    sourceFramesConsumed: chunks.length * 60,
    replayMs: performance.now() - started,
    contactCorrectionFrames: corrections,
    unresolvedArmContacts: contacts,
    strokeWrists: Object.fromEntries(
      Object.entries(wristPoints).map(([key, points]) => {
        const stroke = points.filter((value) => value.frame >= 60 && value.frame < 120)
        return [
          key,
          {
            excursionM: Math.max(
              0,
              ...stroke.map((value) => value.point.distanceTo(stroke[0].point)),
            ),
            travelM: stroke
              .slice(1)
              .reduce((sum, value, i) => sum + value.point.distanceTo(stroke[i].point), 0),
          },
        ]
      }),
    ),
    strokeWindows: Object.fromEntries(
      [800, 1200, 1600, 2000].map((ms) => {
        const points = (wristPoints['final:right'] ?? []).filter(
          (value) => value.frame >= 60 && value.frame < 60 + (ms * 30) / 1000,
        )
        return [ms, Math.max(0, ...points.map((value) => value.point.distanceTo(points[0].point)))]
      }),
    ),
    producerWaitMs: null,
    producerWaitNote:
      'Offline replay measures composition; wall waiting is measured by the live runner.',
    bones: boneReports,
    timings,
  })
}
mkdirSync(output, { recursive: true })
const hash = (filename: string) => createHash('sha256').update(readFileSync(filename)).digest('hex')
writeFileSync(
  path.join(output, 'report.json'),
  JSON.stringify(
    {
      sourceSha256: hash(sourceFile),
      vrmSha256: hash(model),
      pins: source.pins,
      seed: source.seed,
      proceduralMode,
      trackingPolicy,
      rendererFps: 60,
      artisticAcceptance: 'pending',
      cases: summary,
    },
    null,
    2,
  ),
)
writeFileSync(path.join(output, 'samples.json'), JSON.stringify(samples))
console.log(
  JSON.stringify({ output, cases: summary.map((v) => (v as { profileId: string }).profileId) }),
)
