import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'

import type { EmbodimentAvailability } from '../../../../shared/character-response'
import {
  BODY_BONE_NAMES,
  type BodyPresentation,
  getMotionProfile,
  HAND_BONE_NAMES,
  MOTION_CATALOG,
  MOTION_INFERENCE_DEADLINE_MS,
  MOTION_PROFILES,
  type MotionChunk,
  type MotionLease,
  type MotionPhaseId,
  type MotionPlanIdentity,
  type MotionProfileId,
  motionChunkSchema,
  motionProfileSchema,
} from '../../../../shared/motion'
import type { PcmPlaybackClock } from '../../../audio/audioPlayer'
import type { MotionLibraryDebug } from '../../MotionLibraryDebug'
import { type MotionOutcome, MotionPhaseExecution } from '../../MotionPhaseExecution'
import { GeneratedBodySafety } from './GeneratedBodySafety'
import { calibrateFingerSpreadSigns, GeneratedHandPose } from './GeneratedHandPose'
import type { GeneratedBodyDebugState, GeneratedMotionRequestContext } from './GeneratedMotionTypes'
import { plantLeg } from './plantLeg'

// SOMA30 standard T-pose, Y up, metres, world xyzw rotations. No head/neck,
// facial, jaw, eye or finger source is admitted through this body mapping.
const BONES: ReadonlyArray<[number, VRMHumanBoneName]> = [
  [0, 'hips'],
  [1, 'spine'],
  [2, 'chest'],
  [3, 'upperChest'],
  [16, 'rightShoulder'],
  [17, 'rightUpperArm'],
  [18, 'rightLowerArm'],
  [19, 'rightHand'],
  [10, 'leftShoulder'],
  [11, 'leftUpperArm'],
  [12, 'leftLowerArm'],
  [13, 'leftHand'],
  [26, 'rightUpperLeg'],
  [27, 'rightLowerLeg'],
  [28, 'rightFoot'],
  [29, 'rightToes'],
  [22, 'leftUpperLeg'],
  [23, 'leftLowerLeg'],
  [24, 'leftFoot'],
  [25, 'leftToes'],
]

interface Binding {
  index: number
  name: VRMHumanBoneName
  bone: THREE.Object3D
  restInModel: THREE.Quaternion
  filteredLocal: THREE.Quaternion
  safe: THREE.Quaternion
}

/** Bounded generated body owner; the facial Runtime still composes after it. */
export class GeneratedBodyPlayback {
  private vrm: VRM | null = null
  private bindings: Binding[] = []
  private presentationBones: Array<[VRMHumanBoneName, THREE.Object3D]> = []
  private handPose = new GeneratedHandPose()
  private safeHands: ReadonlyMap<VRMHumanBoneName, THREE.Quaternion> = new Map()
  private readonly bodySafety = new GeneratedBodySafety()
  private lastPoseFrame: number | null = null
  private appliedProfileId: MotionProfileId = 'presence_poised'
  private appliedPhaseId: MotionPhaseId = 'prepare'
  private appliedExecutionId: string | undefined
  private appliedOutcome: MotionOutcome | null = null
  private queue: MotionChunk[] = []
  private lease: MotionLease | null = null
  private avatarGeneration = 0
  private localEpoch = 0
  private profileVersion = 0
  private booting = false
  private inFlight = false
  private cursor = 0
  private generatedEnd = 0
  private started = false
  private profileId: MotionProfileId = 'presence_poised'
  private playing = false
  private execution: MotionPhaseExecution | null = null
  private executionSeq = 0
  private phaseAppliedFrame: number | null = null
  private targetWaitStarted: number | null = null
  private phaseWallStarted = 0
  private pendingProfiles: Array<{
    id: string
    context: GeneratedMotionRequestContext
    at: number
    resolve: () => void
    reject: (error: Error) => void
  }> = []
  private familyStarted = new Map<string, number>()
  private recoveryPose = new Map<THREE.Object3D, THREE.Quaternion>()
  private transitionRoute: string[] = []
  private rejectedReason: string | null = null
  private transitionElapsed = 0
  private transitionDuration = 0.3
  private transitionPose = new Map<THREE.Object3D, THREE.Quaternion>()
  private lastUnderrun = false
  private underruns = 0
  private missedSpeechFrames = 0
  private localRecovery = false
  private maxJointSpeed = 0
  private error: string | null = null
  private phase = 'unavailable'
  private lateChunks = 0
  private lastInferenceMs = 0
  private readonly generatedTrace: NonNullable<
    GeneratedBodyDebugState['generatedTrace']
  >[number][] = []
  private traceAt = -Infinity
  private maxHipsDeltaY = 0
  private clock: PcmPlaybackClock | null = null
  private clockId = ''
  private clockBase = 0
  private audibleClockStarted = false
  private speechFinished = false
  private replan = false
  private replanFrom: number | null = null
  private forecast: { phaseId: MotionPhaseId; startFrame: number } | null = null
  private inFlightPhase: MotionPhaseId | null = null
  private composedSpeechClock: { playbackId: string; offset: number } | null = null
  private recoveryRoot = new THREE.Vector3()
  private rekeying = false
  private context: GeneratedMotionRequestContext | null = null
  private camera = 'full'
  private presentationOnly = false
  private mirror: BodyPresentation | null = null
  private mirrorFrom: BodyPresentation | null = null
  private mirrorElapsed = 0
  private mirrorDuration = 1 / 30
  private presentation: BodyPresentation | null = null
  private basePose = new Map<THREE.Object3D, THREE.Quaternion>()
  private baseRoot = new THREE.Vector3()
  private rootAnchor = new THREE.Vector3()
  private chestAnchor = new THREE.Vector3()
  private filteredRootY = 0
  private plantedFeet: Array<{
    upper: THREE.Object3D
    lower: THREE.Object3D
    foot: THREE.Object3D
    target: THREE.Vector3
    orientation: THREE.Quaternion
    pole: THREE.Vector3
  }> = []
  private readiness: {
    version: number
    resolve: () => void
    reject: (error: Error) => void
  } | null = null
  private cancellation: Promise<unknown> = Promise.resolve()
  private startup: Promise<void> | null = null
  private readonly q = new THREE.Quaternion()
  private readonly nextQ = new THREE.Quaternion()
  private readonly parentQ = new THREE.Quaternion()

  constructor(private readonly onFacialChannelsRejected: (count: number) => void) {}

  attach(vrm: VRM): void {
    this.vrm = vrm
    this.avatarGeneration += 1
    vrm.scene.updateMatrixWorld(true)
    const axis = new THREE.Vector3(0, 0, 1)
    const sign = vrm.meta.metaVersion === '0' ? -1 : 1
    const inverseModel = vrm.scene.getWorldQuaternion(new THREE.Quaternion()).invert()
    this.lastPoseFrame = null
    this.appliedExecutionId = undefined
    this.presentationBones = BODY_BONE_NAMES.flatMap((name) => {
      const bone = vrm.humanoid.getNormalizedBoneNode(name)
      return bone ? [[name, bone] as [VRMHumanBoneName, THREE.Object3D]] : []
    })
    const handRest = new Map(
      this.presentationBones
        .filter(([name]) => HAND_BONE_NAMES.some((hand) => hand === name))
        .map(([name, bone]) => [name, bone.quaternion.clone()]),
    )
    const spreadSigns = calibrateFingerSpreadSigns(vrm)
    this.handPose = new GeneratedHandPose(handRest, spreadSigns)
    const safeHandPose = new GeneratedHandPose(handRest, spreadSigns)
    safeHandPose.sample('presence_poised', 0, 0, vrm.meta.metaVersion)
    this.safeHands = safeHandPose.sample('presence_poised', 0.35, 0, vrm.meta.metaVersion)
    this.handPose.reset(this.safeHands)
    this.bindings = BONES.flatMap(([index, name]) => {
      const bone = vrm.humanoid.getNormalizedBoneNode(name)
      if (!bone) return []
      const safe = bone.quaternion.clone()
      if (name === 'rightUpperArm')
        safe.multiply(new THREE.Quaternion().setFromAxisAngle(axis, sign * 1.15))
      if (name === 'leftUpperArm')
        safe.multiply(new THREE.Quaternion().setFromAxisAngle(axis, -sign * 1.15))
      return [
        {
          index,
          name,
          bone,
          restInModel: bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverseModel),
          filteredLocal: safe.clone(),
          safe,
        },
      ]
    })
    this.rootAnchor.copy(
      vrm.humanoid.getNormalizedBoneNode('hips')?.position ?? new THREE.Vector3(),
    )
    this.chestAnchor.copy(
      vrm.humanoid.getNormalizedBoneNode('chest')?.position ?? new THREE.Vector3(),
    )
    this.restoreSafePose()
    this.filteredRootY = this.rootAnchor.y
    this.bodySafety.attach(vrm)
    this.bodySafety.calibrateStandingPose()
    // Recovery must reach a pose admitted by the calibrated contact constraints.
    for (const binding of this.bindings) {
      binding.safe.copy(binding.bone.quaternion)
      binding.filteredLocal.copy(binding.bone.quaternion)
    }
    vrm.scene.updateMatrixWorld(true)
    this.plantedFeet = (['left', 'right'] as const).flatMap((side) => {
      const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`)
      const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`)
      const foot = vrm.humanoid.getNormalizedBoneNode(`${side}Foot`)
      return upper && lower && foot
        ? [
            {
              upper,
              lower,
              foot,
              target: foot.getWorldPosition(new THREE.Vector3()),
              orientation: foot.getWorldQuaternion(new THREE.Quaternion()),
              pole: new THREE.Vector3(0, 0, sign).applyQuaternion(
                vrm.scene.getWorldQuaternion(new THREE.Quaternion()),
              ),
            },
          ]
        : []
    })
    for (const leg of this.plantedFeet)
      plantLeg(leg.upper, leg.lower, leg.foot, leg.target, leg.orientation, leg.pole)
    for (const binding of this.bindings)
      if (/Leg|Foot|Toes/u.test(binding.name)) {
        binding.safe.copy(binding.bone.quaternion)
        binding.filteredLocal.copy(binding.bone.quaternion)
      }
    this.onFacialChannelsRejected(0)
    this.captureBasePose()
  }

  detach(): void {
    this.stopAnimation()
    this.vrm = null
    this.bindings = []
    this.presentationBones = []
    this.mirror = null
    this.mirrorFrom = null
    this.handPose.reset()
    this.safeHands = new Map()
    this.bodySafety.reset()
    this.plantedFeet = []
    this.basePose.clear()
    this.avatarGeneration += 1
  }

  setCameraMode(mode: string): void {
    this.camera = mode
  }
  setPresentationOnly(value: boolean): void {
    this.presentationOnly = value
  }
  setMirror(value: BodyPresentation | null): void {
    if (value && this.vrm) {
      const sameSession =
        this.mirror?.lease.sessionId === value.lease.sessionId &&
        this.mirror?.lease.epoch === value.lease.epoch &&
        this.mirror?.lease.modelGeneration === value.lease.modelGeneration &&
        this.mirror?.lease.avatarGeneration === value.lease.avatarGeneration &&
        this.mirror?.lease.seed === value.lease.seed
      if (sameSession && value.frame < (this.mirror?.frame ?? 0)) return
      if (
        sameSession &&
        value.composedAtMs !== undefined &&
        this.mirror?.composedAtMs !== undefined &&
        value.composedAtMs < this.mirror.composedAtMs
      )
        return
      const frameDelta = sameSession ? value.frame - (this.mirror?.frame ?? value.frame) : 0
      const composedDelta =
        sameSession && value.composedAtMs !== undefined && this.mirror?.composedAtMs !== undefined
          ? (value.composedAtMs - this.mirror.composedAtMs) / 1000
          : 0
      this.mirrorDuration =
        composedDelta > 0
          ? THREE.MathUtils.clamp(composedDelta, 1 / 120, 0.1)
          : frameDelta > 0
            ? THREE.MathUtils.clamp(frameDelta / 30, 1 / 120, 0.1)
            : 1 / 30
      this.mirrorElapsed = 0
      this.mirrorFrom = {
        ...value,
        bones: Object.fromEntries(
          this.presentationBones.map(([name, bone]) => [name, bone.quaternion.toArray()]),
        ),
        hipsPosition:
          this.vrm.humanoid.getNormalizedBoneNode('hips')?.position.toArray() ?? value.hipsPosition,
        chestPosition: this.vrm.humanoid.getNormalizedBoneNode('chest')?.position.toArray(),
      }
    } else this.mirrorFrom = null
    this.mirror = value
    if (!value && this.presentationOnly) {
      this.mirrorElapsed = 0
      this.cursor = 0
      this.profileId = 'presence_poised'
      this.phase = 'stopped'
      // Keep the last primary-composed pose; no second recovery clock in Overlay.
    }
  }
  getPresentation(): BodyPresentation | null {
    return this.presentation
  }
  async settleCancellation(): Promise<void> {
    await this.cancellation
  }

  setClock(clock: PcmPlaybackClock | null): void {
    if (!clock || clock.state === 'cancelled' || clock.state === 'ended') {
      if (this.clock && this.context?.speechBound) {
        if (clock?.state === 'cancelled') this.stopAnimation()
        else {
          this.speechFinished = true
          this.execution?.requestRecovery('speech-ended')
          if (this.execution?.advance(0, false)) this.invalidatePhase()
          this.clockBase = this.cursor
        }
      }
      this.clock = null
      this.audibleClockStarted = false
      return
    }
    if (clock.playbackId !== this.clockId) {
      this.clockId = clock.playbackId
      this.audibleClockStarted = false
      this.speechFinished = false
      this.clockBase = this.cursor - (clock.sourceSampleOffset * 30) / clock.sourceSampleRate
    }
    this.clock = clock
  }

  playProfile(id: string, context: GeneratedMotionRequestContext): Promise<void> {
    if (this.presentationOnly) return Promise.resolve()
    const profile = getMotionProfile(id)
    if (!profile) return Promise.reject(new Error('ARDY_INVALID_PROFILE'))
    const availability = this.profileAvailability(id, context.forceReplay)
    if (
      profile.kind === 'gesture' &&
      profile.qualification.state !== 'qualified' &&
      context.source !== 'debug-preview' &&
      context.source !== 'debug-reroll'
    )
      return Promise.reject(new Error('ARDY_qualification-required'))
    if (!availability.available) {
      this.rejectedReason = availability.reason
      return Promise.reject(new Error(`ARDY_${availability.reason}`))
    }
    if (this.profileId === id && this.playing && !context.forceReplay) return Promise.resolve()
    const execution = this.execution
    if (execution && this.playing && this.started) {
      return new Promise<void>((resolve, reject) => {
        const manual = context.source === 'debug-preview' || context.source === 'debug-reroll'
        this.pendingProfiles = this.pendingProfiles.filter((pending) => {
          if (!manual && getMotionProfile(pending.id)?.family !== profile.family) return true
          pending.reject(new Error('ARDY_PROFILE_SUPERSEDED'))
          return false
        })
        if (this.pendingProfiles.length >= 2) {
          reject(new Error('ARDY_QUEUE_FULL'))
          return
        }
        this.pendingProfiles.push({ id, context, at: performance.now(), resolve, reject })
        const currentZone = execution.profile.accentHands
        const targetZone = profile.accentHands
        const bridge = MOTION_CATALOG.transitionGraph.bridgeEdges.some(
          ([from, to]) => from === currentZone && to === targetZone,
        )
        this.transitionRoute = [
          currentZone,
          bridge ? 'bridge-via-recovery' : 'recover-to-standing',
          'prepare',
          targetZone,
        ]
        execution.requestRecovery()
      })
    }
    return this.beginProfile(id, context)
  }

  private beginProfile(id: string, context: GeneratedMotionRequestContext): Promise<void> {
    const profile = getMotionProfile(id)
    if (!profile) return Promise.reject(new Error('ARDY_INVALID_PROFILE'))
    this.readiness?.reject(new Error('ARDY_PROFILE_SUPERSEDED'))
    this.profileVersion += 1
    this.profileId = motionProfileSchema.parse(id)
    this.context = context
    this.speechFinished = false
    this.composedSpeechClock = null
    if (this.clock)
      this.clockBase =
        this.cursor - (this.clock.sourceSampleOffset * 30) / this.clock.sourceSampleRate
    this.playing = true
    this.error = null
    this.rejectedReason = null
    this.execution = new MotionPhaseExecution(
      `${this.avatarGeneration}:${this.localEpoch}:${++this.executionSeq}`,
      profile,
    )
    this.phaseAppliedFrame = null
    this.targetWaitStarted = null
    this.lastPoseFrame = null
    this.localRecovery = false
    this.missedSpeechFrames = 0
    this.phaseWallStarted = performance.now()
    this.transitionElapsed = 0
    this.transitionDuration = Math.max(0.05, Math.min(2, context.blendDuration ?? 0.3))
    this.transitionPose = new Map(
      this.bindings.map((binding) => [binding.bone, binding.bone.quaternion.clone()]),
    )
    // Only an execution boundary may seed the filter from the applied pose.
    // Per-frame IK/procedural corrections must not feed back into neural smoothing.
    this.vrm?.scene.updateMatrixWorld(true)
    for (const binding of this.bindings) binding.filteredLocal.copy(binding.bone.quaternion)
    this.filteredRootY =
      this.vrm?.humanoid.getNormalizedBoneNode('hips')?.position.y ?? this.rootAnchor.y
    this.queue = []
    this.forecast = null
    this.replanFrom = null
    this.generatedEnd = Math.floor(this.cursor)
    this.replan = true
    this.phase = 'loading'
    const readiness = new Promise<void>((resolve, reject) => {
      this.readiness = { version: this.profileVersion, resolve, reject }
    })
    if (context.forceReplay && this.lease && !this.rekeying) {
      const epoch = this.localEpoch
      this.rekeying = true
      void window.api.motion
        .reroll({ lease: this.lease, seed: context.seed })
        .then((result) => {
          if (epoch !== this.localEpoch) return
          if (!result.ok) throw new Error(result.error)
          this.lease = result.lease
          this.queue = []
          this.generatedEnd = Math.floor(this.cursor)
          this.replan = true
        })
        .catch((error) => {
          if (epoch === this.localEpoch) this.fail(error)
        })
        .finally(() => {
          this.rekeying = false
          this.pump()
        })
    }
    this.pump()
    return readiness
  }

  private plan(): MotionPlanIdentity {
    const execution = this.execution
    const lease = this.lease
    if (!execution || !lease) throw new Error('ARDY_INVALID_PLAN_STATE')
    return execution.plan(`${lease.sessionId}:${this.localEpoch}`)
  }

  private invalidatePhase(): void {
    const promotion = this.forecast?.phaseId === this.execution?.phase
    const phaseStart = promotion ? this.forecast?.startFrame : null
    this.forecast = null
    this.phaseAppliedFrame = phaseStart ?? null
    this.targetWaitStarted = null
    this.phaseWallStarted = performance.now()
    if (promotion) {
      // The new physical phase is already queued or in flight. Its generation
      // plan stays valid; the previous accepted tail covers the planned boundary.
      this.replanFrom = null
      this.replan = false
      return
    }
    this.profileVersion += 1
    const bridge = !this.clock && this.execution?.phase !== 'recover'
    const tail =
      this.queue.find((chunk) => chunk.startFrame + 60 >= this.cursor + 60) ?? this.queue.at(-1)
    const boundary = tail ? tail.startFrame + 60 : Math.floor(this.cursor / 4) * 4
    this.replanFrom = bridge ? Math.floor(boundary / 4) * 4 : null
    this.queue = bridge ? this.queue.filter((chunk) => chunk.startFrame < boundary) : []
    const remaining = this.queue.at(-1)
    this.generatedEnd = remaining ? remaining.startFrame + 60 : Math.floor(this.cursor)
    this.phaseAppliedFrame = null
    this.phaseWallStarted = performance.now()
    this.replan = true
    if (this.execution?.phase === 'recover') {
      this.localRecovery = true
      this.execution.ready = true
      this.recoveryRoot.copy(
        this.vrm?.humanoid.getNormalizedBoneNode('hips')?.position ?? this.baseRoot,
      )
      this.recoveryPose = new Map(
        this.bindings.map((binding) => [
          binding.bone,
          (this.basePose.get(binding.bone) ?? binding.bone.quaternion).clone(),
        ]),
      )
      this.execution.setClock(null)
    }
  }

  recover(): void {
    this.execution?.requestRecovery()
  }

  releaseSpeechPreparation(profileId: string): void {
    this.pendingProfiles = this.pendingProfiles.filter((pending) => {
      if (pending.id !== profileId || !pending.context.speechBound) return true
      pending.reject(new Error('ARDY_STALE_INTENT'))
      return false
    })
    if (this.profileId !== profileId || !this.context?.speechBound) return
    this.speechFinished = true
    this.execution?.requestRecovery('speech-ended')
    if (this.execution?.advance(0, false)) this.invalidatePhase()
  }

  private profileAvailability(
    id: string,
    repeat = false,
  ): { available: boolean; reason: string | null } {
    const profile = getMotionProfile(id)
    const vrm = this.vrm
    if (!vrm) return { available: false, reason: 'model-not-ready' }
    if (!repeat && !this.playing && this.error && (this.phase === 'degraded' || !this.lease))
      return { available: false, reason: 'generator-unavailable' }
    if (!profile || profile.qualification.state === 'disabled')
      return { available: false, reason: 'disabled' }
    const required = [
      ...HAND_BONE_NAMES,
      'leftHand',
      'rightHand',
      'hips',
      'spine',
      'leftUpperLeg',
      'leftLowerLeg',
      'rightUpperLeg',
      'rightLowerLeg',
      'leftUpperArm',
      'leftLowerArm',
      'rightUpperArm',
      'rightLowerArm',
      'leftFoot',
      'rightFoot',
    ] as const
    if (required.some((name) => !vrm.humanoid.getNormalizedBoneNode(name)))
      return { available: false, reason: 'rig-unsupported' }
    const anchors = Object.values(profile.handScore.phases).flatMap((pair) =>
      Object.values(pair)
        .filter((hand) => hand.workspace !== 'relaxed')
        .map((hand) => MOTION_CATALOG.handWorkspaces[hand.workspace].anchor),
    )
    if (anchors.some((name) => !vrm.humanoid.getNormalizedBoneNode(name)))
      return { available: false, reason: 'rig-unsupported' }
    if (!profile.cameraPolicy.includes(this.camera as 'full' | 'bust' | 'face'))
      return { available: false, reason: 'camera-incompatible' }
    if (
      !repeat &&
      profile.kind === 'gesture' &&
      performance.now() - (this.familyStarted.get(profile.family) ?? -Infinity) <
        profile.variationPolicy.cooldownFamilyMs
    )
      return { available: false, reason: 'cooldown' }
    return { available: true, reason: null }
  }

  validateFinalComposition(delta = 1 / 60): void {
    if (this.presentationOnly || !this.playing) return
    this.bodySafety.setHandTargets(
      getMotionProfile(this.appliedProfileId),
      this.localRecovery ? 'recover' : (this.appliedPhaseId ?? 'prepare'),
    )
    const pcm =
      !this.localRecovery && this.clock && this.clock.sourceSampleOffset > 0 ? this.clock : null
    const samePlayback = pcm && this.composedSpeechClock?.playbackId === pcm.playbackId
    const consumedDelta =
      pcm && samePlayback
        ? Math.max(
            0,
            (pcm.sourceSampleOffset -
              (this.composedSpeechClock?.offset ?? pcm.sourceSampleOffset)) /
              pcm.sourceSampleRate,
          )
        : delta
    this.bodySafety.apply(
      consumedDelta > 0 ? Math.min(0.05, consumedDelta) : delta,
      getMotionProfile(this.profileId)?.kind === 'presence' ? 0.35 : 1,
      consumedDelta > 0,
    )
    for (const leg of this.plantedFeet)
      plantLeg(leg.upper, leg.lower, leg.foot, leg.target, leg.orientation, leg.pole)
    this.composedSpeechClock = pcm
      ? { playbackId: pcm.playbackId, offset: pcm.sourceSampleOffset }
      : null
  }

  getEmbodimentAvailability(): EmbodimentAvailability {
    const compatible = MOTION_PROFILES.filter(
      (profile) => this.profileAvailability(profile.id, true).available,
    )
    const qualified = compatible.filter((profile) => profile.qualification.state === 'qualified')
    const ready = this.phase === 'ready' && this.lease !== null && !this.error
    return {
      version: 2,
      catalogRevision: MOTION_CATALOG.catalogRevision,
      modelGeneration: this.lease?.modelGeneration ?? this.avatarGeneration,
      availableSemanticIntents: ready
        ? [
            ...new Set(
              qualified
                .filter(
                  (profile) =>
                    profile.automaticSelection &&
                    profile.defaultWeight > 0 &&
                    profile.usage.speaking &&
                    this.profileAvailability(profile.id).available,
                )
                .flatMap((profile) => (profile.semanticIntent ? [profile.semanticIntent] : [])),
            ),
          ]
        : [],
      unavailableReasons: !this.vrm
        ? ['model-unavailable']
        : !compatible.length
          ? ['rig-unsupported']
          : !ready
            ? ['motion-unavailable']
            : qualified.length < compatible.length
              ? ['unqualified']
              : [],
      qualification:
        compatible.length > 0 && qualified.length === compatible.length ? 'qualified' : 'draft',
    }
  }

  getLibraryDebug(): MotionLibraryDebug {
    const mirror = this.presentationOnly ? this.mirror : null
    return {
      profileId: mirror?.profileId ?? this.execution?.profile.id ?? null,
      runningProfileId: mirror
        ? mirror.outcome
          ? null
          : mirror.profileId
        : this.playing
          ? this.profileId
          : null,
      posture: 'standing',
      phase: mirror?.phaseId ?? this.execution?.phase ?? null,
      handPhase: mirror?.phaseId ?? (this.appliedExecutionId ? this.appliedPhaseId : null),
      transitionRoute: [...this.transitionRoute],
      rejectedReason: this.rejectedReason,
      profiles: Object.fromEntries(
        MOTION_PROFILES.map((profile) => [profile.id, this.profileAvailability(profile.id, true)]),
      ),
      executionId: mirror?.executionId ?? this.execution?.id ?? null,
      outcome: mirror?.outcome ?? this.execution?.outcome ?? null,
      blendRemaining: Math.max(0, this.transitionDuration - this.transitionElapsed),
      underruns: this.underruns,
    }
  }

  private finishExecution(outcome: MotionOutcome): void {
    if (this.execution?.id === this.appliedExecutionId) this.appliedOutcome = outcome
    if (this.execution) this.execution.outcome = outcome
    this.playing = false
    this.queue = []
    this.readiness?.reject(new Error(`ARDY_${outcome}`))
    this.readiness = null
    const now = performance.now()
    while (this.pendingProfiles.length) {
      const next = this.pendingProfiles.shift()
      if (!next) break
      const profile = getMotionProfile(next.id)
      if (
        !profile ||
        !this.profileAvailability(next.id, next.context.forceReplay).available ||
        now - next.at > profile.variationPolicy.intentTtlMs
      ) {
        next.reject(new Error('ARDY_STALE_INTENT'))
        this.rejectedReason = 'stale-intent'
        continue
      }
      void this.beginProfile(next.id, next.context).then(next.resolve, next.reject)
      return
    }
  }

  stopAnimation(reason = 'ARDY_CANCELLED'): void {
    this.presentation = null
    if (this.execution && !this.execution.outcome) this.execution.outcome = 'cancelled'
    for (const pending of this.pendingProfiles) pending.reject(new Error(reason))
    this.pendingProfiles = []
    this.localEpoch += 1
    this.profileVersion += 1
    this.playing = false
    this.localRecovery = false
    this.queue.length = 0
    this.replanFrom = null
    this.forecast = null
    this.started = false
    this.lastPoseFrame = null
    this.cursor = 0
    this.generatedEnd = 0
    this.clock = null
    this.clockId = ''
    this.readiness?.reject(new Error(reason))
    this.readiness = null
    const lease = this.lease
    this.lease = null
    const pendingStartup = this.startup
    const stop =
      lease || this.booting
        ? window.api.motion
            .stop(lease ?? { avatarGeneration: this.avatarGeneration })
            .then((result) => {
              if (!result.ok) throw new Error('ARDY_CANCEL_FAILED')
            })
            .catch((error: unknown) => {
              this.error = 'ARDY_CANCEL_FAILED'
              throw error
            })
        : this.cancellation
    this.cancellation = Promise.all([stop, pendingStartup])
    void this.cancellation.catch(() => {
      this.error = 'ARDY_CANCEL_FAILED'
    })
    // A cancelled turn never applies another generated frame.
    // Cancellation holds the last valid body pose.
    this.phase = 'stopped'
  }

  update(delta: number, beforeDiagnostics: () => void): void {
    // Recompose from the last uncorrected base even while a horizon/PCM waits.
    // Feeding last frame's contact/IK result back through safety caused a snap
    // whenever the generator paused at a phase boundary.
    if (!this.presentationOnly && this.playing && this.vrm && this.basePose.size) {
      for (const [bone, rotation] of this.basePose) bone.quaternion.copy(rotation)
      this.vrm.humanoid.getNormalizedBoneNode('hips')?.position.copy(this.baseRoot)
      this.vrm.scene.updateMatrixWorld(true)
    }
    let composed = false
    const compose = (): void => {
      if (composed) return
      composed = true
      beforeDiagnostics()
      this.validateFinalComposition(delta)
    }
    if (this.playing && this.execution?.wantsRecovery && this.execution.advance(0, false))
      this.invalidatePhase()
    if (this.presentationOnly) {
      if (this.mirror && this.vrm) {
        this.mirrorElapsed = Math.min(this.mirrorDuration, this.mirrorElapsed + Math.max(0, delta))
        const blend = this.mirrorElapsed / this.mirrorDuration
        for (const [name, bone] of this.presentationBones) {
          const value = this.mirror.bones[name as keyof typeof this.mirror.bones]
          const from = this.mirrorFrom?.bones[name as keyof typeof this.mirror.bones] ?? value
          if (value && from) {
            this.q.fromArray(from)
            this.nextQ.fromArray(value)
            bone.quaternion.copy(this.q.slerp(this.nextQ, blend)).normalize()
          }
        }
        for (const [name, target, from] of [
          ['hips', this.mirror.hipsPosition, this.mirrorFrom?.hipsPosition],
          ['chest', this.mirror.chestPosition, this.mirrorFrom?.chestPosition],
        ] as const) {
          const bone = this.vrm.humanoid.getNormalizedBoneNode(name)
          if (bone && target)
            bone.position
              .fromArray(from ?? target)
              .lerp(new THREE.Vector3().fromArray(target), blend)
        }
        this.cursor = this.mirror.frame
        this.profileId = this.mirror.profileId
        this.phase = 'mirror'
      }
      compose()
      return
    }
    if (this.started && this.playing && !this.localRecovery) {
      const recovering = this.execution?.phase === 'recover'
      const audibleClock = this.clock && this.clock.sourceSampleOffset > 0 ? this.clock : null
      const audible = audibleClock !== null
      if (audibleClock && !this.audibleClockStarted) {
        this.clockBase =
          this.cursor - (audibleClock.sourceSampleOffset * 30) / audibleClock.sourceSampleRate
        this.audibleClockStarted = true
      }
      const playback = !recovering && audibleClock ? audibleClock.playbackId : null
      const initialBinding =
        playback !== null && this.plan().clockDomain === 'local' && !this.execution?.wantsRecovery
      if (this.execution?.setClock(playback)) {
        // Initial PCM adopts unconsumed preparation, including in-flight work.
        // Later identity changes retain only the matching physical phase tail.
        if (!initialBinding) {
          if (this.forecast) this.execution.requestRecovery()
          this.forecast = null
          this.profileVersion += 1
          this.replan = true
          this.queue = this.queue.filter((chunk) => chunk.plan.phaseId === this.execution?.phase)
          const tail = this.queue.at(-1)
          this.generatedEnd = tail ? tail.startFrame + 60 : Math.floor(this.cursor)
          this.replanFrom = null
        }
      }
      const waitingAudio =
        this.context?.speechBound &&
        !this.speechFinished &&
        !audible &&
        !this.execution?.wantsRecovery &&
        this.execution?.progress === 1
      const coverageCursor = audible
        ? Math.max(this.cursor, this.phaseAppliedFrame ?? this.cursor)
        : this.cursor
      const waitingPhase =
        this.execution &&
        !this.execution.ready &&
        !this.queue.some(
          (chunk) =>
            chunk.plan.executionId === this.execution?.id &&
            (chunk.plan.phaseId === this.execution?.phase || !audible) &&
            chunk.startFrame <= coverageCursor &&
            coverageCursor < chunk.startFrame + 60,
        )

      if (waitingPhase && audibleClock) {
        // Hold the applied pose while preparing the new phase, with no catch-up
        // against samples consumed during provider work.
        this.clockBase =
          this.cursor - (audibleClock.sourceSampleOffset * 30) / audibleClock.sourceSampleRate
        const readinessDeadline =
          this.execution?.phase === 'prepare' ? MOTION_INFERENCE_DEADLINE_MS : 400
        if (performance.now() - this.phaseWallStarted > readinessDeadline) {
          this.error = 'ARDY_PHASE_DEADLINE_MISSED'
          this.execution?.requestFailureRecovery()
        }
      }
      let desired =
        waitingAudio || waitingPhase
          ? this.cursor
          : !recovering && audibleClock
            ? Math.max(
                this.cursor,
                this.clockBase +
                  (audibleClock.sourceSampleOffset * 30) / audibleClock.sourceSampleRate,
              )
            : this.cursor + Math.max(0, Math.min(0.1, delta)) * 30
      const boundaryHandoff =
        this.forecast &&
        this.generatedEnd >= this.forecast.startFrame &&
        desired - this.forecast.startFrame < 3
      if (
        !recovering &&
        !waitingPhase &&
        audibleClock &&
        desired > this.generatedEnd &&
        !boundaryHandoff
      ) {
        this.missedSpeechFrames += desired - this.generatedEnd
        // The accent missed audible time. Recover locally; never replay it late.
        if (this.missedSpeechFrames >= 3) this.execution?.requestFailureRecovery()
        this.clockBase =
          this.cursor - (audibleClock.sourceSampleOffset * 30) / audibleClock.sourceSampleRate
        this.error = 'ARDY_AUDIBLE_UNDERRUN'
        desired = this.cursor
      }
      if (
        this.forecast &&
        this.queue.some(
          (chunk) =>
            chunk.startFrame === this.forecast?.startFrame &&
            chunk.plan.phaseId === this.forecast.phaseId,
        )
      )
        desired = Math.min(desired, this.forecast.startFrame - 0.00001)
      this.cursor = Math.max(this.cursor, Math.min(this.generatedEnd, desired))
    }
    if (this.localRecovery && this.playing && this.execution && this.vrm) {
      this.applyLocalRecovery(delta)
      compose()
      this.execution.advance(
        Math.max(0, Math.min(0.05, delta)),
        this.handPose.targetsReached() &&
          this.execution.progress >= 1 &&
          this.recoveryExitReached(),
      )
      if (
        !this.execution.outcome &&
        performance.now() - this.phaseWallStarted > Math.max(10000, this.execution.budget.maxMs * 3)
      )
        this.execution.outcome = 'timed-out'
      this.phase = 'ready'
      if (this.execution.outcome === 'timed-out') {
        this.error ??= 'ARDY_RECOVERY_TARGET_UNREACHED'
        this.phase = 'degraded'
      }
      if (this.execution.outcome) this.finishExecution(this.execution.outcome)
      if (this.lease && this.started) this.capturePresentation()
      return
    }
    while (this.queue.length && this.queue[0].startFrame + 60 <= this.cursor) this.queue.shift()
    const execution = this.execution
    const covers = (item: MotionChunk): boolean =>
      item.startFrame <= this.cursor && this.cursor < item.startFrame + 60
    const chunk =
      this.queue.findLast((item) => covers(item) && item.plan.phaseId === execution?.phase) ??
      this.queue.findLast((item) => covers(item) && item.plan.phaseId !== this.forecast?.phaseId)
    if (chunk && this.vrm && this.playing && execution) {
      const phaseReady = chunk.plan.phaseId === execution.phase
      const phaseDelta =
        phaseReady && execution.ready
          ? Math.max(0, (this.cursor - (this.phaseAppliedFrame ?? chunk.startFrame)) / 30)
          : 0
      const progress = Math.min(
        1,
        (execution.elapsedMs + phaseDelta * 1000) / execution.budget.minMs,
      )
      this.apply(chunk, delta, progress)
      this.phase = phaseReady ? 'ready' : 'loading'
      execution.ready = phaseReady
      compose()
      const waiting = this.pendingProfiles[0]
      if (waiting && execution.phase === 'hold' && execution.profile.kind === 'presence')
        execution.requestRecovery()
      if (
        waiting &&
        execution.phase === 'hold' &&
        this.maxJointSpeed < 0.75 &&
        this.handPose.transitionError(waiting.id) < 0.3
      ) {
        const next = getMotionProfile(waiting.id)
        if (
          next &&
          MOTION_CATALOG.transitionGraph.directEdges.some(
            ([from, to]) => from === execution.profile.accentHands && to === next.accentHands,
          )
        ) {
          this.transitionRoute = [
            execution.profile.accentHands,
            'direct-continuation',
            'prepare',
            next.accentHands,
          ]
          this.finishExecution('superseded')
          compose()
          if (this.lease && this.started) this.capturePresentation()
          return
        }
      }
      if (this.phaseAppliedFrame === null && execution.phase === 'prepare')
        this.familyStarted.set(execution.profile.family, performance.now())
      if (phaseReady) this.phaseAppliedFrame = this.cursor
      const recovered =
        execution.phase !== 'recover' ||
        this.bindings
          .filter((binding) => /Arm|Shoulder|Hand/.test(binding.name))
          .every((binding) => {
            const target = binding.safe
              .clone()
              .multiply(this.handPose.getWristOffsets().get(binding.name) ?? new THREE.Quaternion())
            return binding.bone.quaternion.angleTo(target) < 0.035
          })
      const canAccent =
        execution.phase !== 'prepare' ||
        execution.wantsRecovery ||
        !this.context?.speechBound ||
        this.speechFinished ||
        (this.clock?.sourceSampleOffset ?? 0) > 0
      const targetsReached =
        this.handPose.targetsReached() && this.bodySafety.handTargetsReached() && recovered
      if (
        phaseReady &&
        canAccent &&
        execution.phase !== 'recover' &&
        execution.progress >= 1 &&
        !targetsReached &&
        (!this.context?.speechBound || this.speechFinished || this.clock?.state === 'playing')
      ) {
        this.targetWaitStarted ??= performance.now()
        if (
          performance.now() - this.targetWaitStarted >
          execution.budget.maxMs - execution.budget.minMs
        ) {
          this.error = 'ARDY_SPATIAL_TARGET_UNREACHED'
          execution.requestFailureRecovery()
        }
      } else this.targetWaitStarted = null
      if (phaseReady && canAccent && execution.advance(phaseDelta, targetsReached)) {
        this.invalidatePhase()
        if (execution.hasTimedOut) this.error = 'ARDY_SPATIAL_TARGET_UNREACHED'
      } else if (!canAccent)
        execution.elapsedMs = Math.min(
          execution.budget.minMs,
          execution.elapsedMs + phaseDelta * 1000,
        )
      if (execution.outcome) this.finishExecution(execution.outcome)
      this.lastUnderrun = false
    } else if (this.playing && this.started) {
      if (!execution?.ready) {
        this.phase = 'loading'
      } else {
        this.phase = 'degraded'
        if (!this.lastUnderrun) this.underruns += 1
        this.lastUnderrun = true
      }
    }
    if (
      this.playing &&
      !this.booting &&
      !this.execution?.ready &&
      performance.now() - this.phaseWallStarted > 120000
    ) {
      this.finishExecution('timed-out')
      this.error = 'ARDY_PHASE_READINESS_TIMEOUT'
      this.phase = 'degraded'
    }
    if (this.playing && !this.localRecovery) this.pump()
    const now = performance.now()
    const previousTrace = this.generatedTrace.at(-1)
    if (
      now - this.traceAt >= 500 ||
      previousTrace?.phase !== this.phase ||
      previousTrace.profileId !== this.profileId
    ) {
      this.traceAt = now
      this.generatedTrace.push({
        at: now,
        profileId: this.profileId,
        phase: this.phase,
        sourceFrame: this.cursor,
        sourceSampleOffset: this.clock?.sourceSampleOffset ?? null,
        queueFrames: this.queue.reduce((sum, item) => sum + item.rotations.length, 0),
        lateChunks: this.lateChunks,
      })
      if (this.generatedTrace.length > 120) this.generatedTrace.shift()
    }
    compose()
    if (this.lease && this.started) this.capturePresentation()
  }

  private recoveryExitReached(): boolean {
    return this.recoveryBlocker() === null
  }

  private recoveryBlocker(): 'hands' | 'arms' | 'root' | 'feet' | null {
    const execution = this.execution
    const vrm = this.vrm
    if (!execution || !vrm || this.plantedFeet.length !== 2) return 'feet'
    if (!this.handPose.targetsReached()) return 'hands'
    const wrists = this.handPose.getWristOffsets()
    const armsRecovered = this.bindings
      .filter((binding) => /Arm|Shoulder|Hand/u.test(binding.name))
      .every((binding) => {
        const target = binding.safe
          .clone()
          .multiply(wrists.get(binding.name) ?? new THREE.Quaternion())
        return binding.bone.quaternion.angleTo(target) <= 0.06
      })
    if (!armsRecovered) return 'arms'
    const scale =
      Math.abs(this.rootAnchor.y) > 1e-6 ? Math.abs(this.rootAnchor.y) / 0.9887084839474641 : 1
    const hips = vrm.humanoid.getNormalizedBoneNode('hips')
    const rootTolerance = execution.profile.supportPolicy.maxVerticalRootM * scale + 0.002
    if (!hips || hips.position.distanceTo(this.rootAnchor) > rootTolerance) return 'root'
    vrm.scene.updateMatrixWorld(true)
    const worldScale = vrm.scene.getWorldScale(new THREE.Vector3())
    const footTolerance = 0.01 * scale * Math.max(0.001, Math.abs(worldScale.y))
    return this.plantedFeet.every(
      (leg) =>
        leg.foot.getWorldPosition(new THREE.Vector3()).distanceTo(leg.target) <= footTolerance,
    )
      ? null
      : 'feet'
  }

  private applyLocalRecovery(delta: number): void {
    const execution = this.execution
    if (!execution || !this.vrm) return
    this.appliedPhaseId = 'recover'
    const t = Math.min(
      1,
      (execution.elapsedMs + Math.max(0, Math.min(0.05, delta)) * 1000) / execution.budget.minMs,
    )
    const smooth = t * t * (3 - 2 * t)
    const fingers = this.handPose.sampleScore(
      this.profileId,
      execution.id,
      'recover',
      t,
      this.vrm.meta.metaVersion,
    )
    const wrists = this.handPose.getWristOffsets()
    for (const binding of this.bindings) {
      const safe = binding.safe.clone().multiply(wrists.get(binding.name) ?? new THREE.Quaternion())
      binding.bone.quaternion
        .copy(this.recoveryPose.get(binding.bone) ?? binding.bone.quaternion)
        .slerp(safe, smooth)
    }
    for (const [name, bone] of this.presentationBones) {
      const rotation = fingers.get(name)
      if (rotation) bone.quaternion.copy(rotation)
    }
    this.vrm.humanoid
      .getNormalizedBoneNode('hips')
      ?.position.copy(this.recoveryRoot)
      .lerp(this.rootAnchor, smooth)
    this.captureBasePose()
  }

  private apply(chunk: MotionChunk, renderDelta: number, phaseProgress: number): void {
    const vrm = this.vrm
    const execution = this.execution
    if (!vrm || !execution || this.lastPoseFrame === this.cursor) return
    const elapsed =
      this.lastPoseFrame === null ? 1 / 30 : Math.max(0, (this.cursor - this.lastPoseFrame) / 30)
    const profile = MOTION_PROFILES.find((entry) => entry.id === chunk.profileId)
    const presence = profile?.kind === 'presence'
    const blend = 1 - Math.exp(-(presence ? 4 : 10) * Math.min(0.1, elapsed))
    this.transitionElapsed = Math.min(this.transitionDuration, this.transitionElapsed + elapsed)
    this.lastPoseFrame = this.cursor
    this.appliedProfileId = chunk.profileId
    this.appliedPhaseId = chunk.plan.phaseId
    if (this.appliedExecutionId !== chunk.plan.executionId) this.appliedOutcome = null
    this.appliedExecutionId = chunk.plan.executionId
    const hand = this.handPose.sampleScore(
      chunk.profileId,
      execution.id,
      chunk.plan.phaseId,
      chunk.plan.phaseId === execution.phase ? phaseProgress : 1,
      vrm.meta.metaVersion,
    )
    const wrists = this.handPose.getWristOffsets()
    const offset = this.cursor - chunk.startFrame
    const frame = Math.min(59, Math.floor(offset)),
      fraction = offset - frame
    const following =
      frame < 59 ? chunk : this.queue.find((item) => item.startFrame === chunk.startFrame + 60)
    const next =
      frame < 59
        ? chunk.rotations[frame + 1]
        : (this.queue.find((item) => item.startFrame === chunk.startFrame + 60)?.rotations[0] ??
          chunk.rotations[frame])
    const targetWorld = new Map<THREE.Object3D, THREE.Quaternion>()
    const localTargets: THREE.Quaternion[] = []
    const modelWorld = vrm.scene.getWorldQuaternion(new THREE.Quaternion())
    for (const binding of this.bindings) {
      this.q.fromArray(chunk.rotations[frame][binding.index]).normalize()
      this.nextQ.fromArray(next[binding.index]).normalize()
      this.q.slerp(this.nextQ, fraction)
      if (profile?.rootPolicy.mode === 'anchored-standing' && binding.index <= 3) {
        // Bound anatomical lean separately from yaw. Independent 17-degree
        // world clamps allowed adjacent trunk segments to counter-bend sharply.
        const yaw = new THREE.Quaternion(0, this.q.y, 0, this.q.w)
        if (yaw.lengthSq() < 1e-8) yaw.identity()
        else yaw.normalize()
        const swing = this.q.clone().multiply(yaw.clone().invert())
        const limit = THREE.MathUtils.degToRad(binding.index === 0 ? 2 : 5)
        const angle = swing.angleTo(new THREE.Quaternion())
        if (angle > limit)
          swing.identity().slerp(this.q.clone().multiply(yaw.clone().invert()), limit / angle)
        const yawLimit = THREE.MathUtils.degToRad(binding.index === 0 ? 3 : 8)
        const yawAngle = yaw.angleTo(new THREE.Quaternion())
        if (yawAngle > yawLimit)
          yaw
            .identity()
            .slerp(new THREE.Quaternion(0, this.q.y, 0, this.q.w).normalize(), yawLimit / yawAngle)
        this.q.copy(swing).multiply(yaw).normalize()
      }
      if (vrm.meta.metaVersion === '0') {
        this.q.x *= -1
        this.q.z *= -1
      }
      this.q.multiply(binding.restInModel).premultiply(modelWorld)
      targetWorld.set(binding.bone, this.q.clone())
      const parent = binding.bone.parent
      const plannedParent = parent ? targetWorld.get(parent) : undefined
      if (plannedParent) this.parentQ.copy(plannedParent)
      else if (parent) parent.getWorldQuaternion(this.parentQ)
      else this.parentQ.identity()
      this.q.premultiply(this.parentQ.invert()).normalize()
      const wrist = wrists.get(binding.name)
      if (wrist) this.q.multiply(wrist).normalize()
      // Smooth within the anatomical joint domain, before final contact/IK.
      // A raw target crossing the hinge/twist boundary must not snap the output.
      this.bodySafety.constrainTarget(binding.bone, this.q)
      const side = binding.name.startsWith('left')
        ? 'left'
        : binding.name.startsWith('right')
          ? 'right'
          : null
      const support = side
        ? profile?.handScore.phases[chunk.plan.phaseId][side].role === 'support'
        : false
      if (
        profile &&
        side &&
        /Arm|Shoulder/u.test(binding.name) &&
        (presence ||
          binding.name.includes('Shoulder') ||
          profile.accentHands === 'relaxed' ||
          profile.handScore.phases[chunk.plan.phaseId][side].role === 'support')
      ) {
        const maximum = binding.name.includes('Shoulder')
          ? presence || support
            ? 0.08
            : 0.2
          : binding.name.includes('LowerArm')
            ? presence || support
              ? 0.25
              : 0.45
            : presence || support
              ? 0.12
              : 0.2
        const angle = binding.safe.angleTo(this.q)
        if (angle > maximum) {
          this.nextQ.copy(this.q)
          this.q.copy(binding.safe).slerp(this.nextQ, maximum / angle)
        }
      }
      const target = binding.filteredLocal.clone().slerp(this.q, blend)
      const speed = /LowerArm/u.test(binding.name) ? (presence ? 0.45 : 1) : presence ? 1 : 2.5
      binding.filteredLocal.rotateTowards(target, speed * Math.max(0, Math.min(0.05, renderDelta)))
      localTargets.push(binding.filteredLocal.clone())
    }
    this.maxJointSpeed = 0
    for (const [index, binding] of this.bindings.entries()) {
      const before = binding.bone.quaternion.clone()
      const target = localTargets[index]
      if (this.transitionElapsed < this.transitionDuration) {
        const from = this.transitionPose.get(binding.bone)
        if (from) {
          const generated = target.clone()
          target.copy(from).slerp(generated, this.transitionElapsed / this.transitionDuration)
        }
      }
      binding.bone.quaternion.copy(target).normalize()
      this.maxJointSpeed = Math.max(
        this.maxJointSpeed,
        before.angleTo(binding.bone.quaternion) / Math.max(0.001, elapsed),
      )
      binding.bone.updateMatrixWorld(true)
    }
    const hips = vrm.humanoid.getNormalizedBoneNode('hips')
    if (hips && profile) {
      const root = new THREE.Vector3().fromArray(chunk.rootPositions[frame])
      const nextRoot =
        following?.rootPositions[frame < 59 ? frame + 1 : 0] ?? chunk.rootPositions[frame]
      root.lerp(new THREE.Vector3().fromArray(nextRoot), fraction)
      const scale = this.rootAnchor.y / 0.9887084839474641
      hips.position.copy(this.rootAnchor)
      const rootTarget = Math.min(
        this.rootAnchor.y - 0.002 * Math.abs(scale),
        this.rootAnchor.y +
          Math.max(
            -profile.supportPolicy.maxVerticalRootM,
            Math.min(profile.supportPolicy.maxVerticalRootM, (root.y - 0.9887084839474641) * scale),
          ),
      )
      // Near straight legs, millimetres of root noise become visible knee
      // flexion. Filter translation before the single planted-foot solve.
      const rootDelta = (rootTarget - this.filteredRootY) * (1 - Math.exp(-3 * elapsed))
      const rootSeconds = Math.max(0, Math.min(elapsed, renderDelta, 0.05))
      this.filteredRootY = this.limitStandingRootY(
        this.filteredRootY +
          THREE.MathUtils.clamp(rootDelta, -0.015 * rootSeconds, 0.015 * rootSeconds),
        rootSeconds,
      )
      hips.position.y = this.filteredRootY
      if (profile.rootPolicy.mode !== 'anchored-standing') {
        const sign = vrm.meta.metaVersion === '0' ? -1 : 1
        hips.position.x += root.x * scale * sign
        hips.position.z += root.z * scale * sign
      }
      hips.updateMatrixWorld(true)
      this.maxHipsDeltaY = Math.max(
        this.maxHipsDeltaY,
        Math.abs(hips.position.y - this.rootAnchor.y),
      )
    }
    if (execution.phase === 'recover') {
      const t = execution.progress
      const smooth = t * t * (3 - 2 * t)
      for (const binding of this.bindings) {
        const safe = binding.safe
          .clone()
          .multiply(wrists.get(binding.name) ?? new THREE.Quaternion())
        binding.bone.quaternion
          .copy(this.recoveryPose.get(binding.bone) ?? binding.bone.quaternion)
          .slerp(safe, smooth)
      }
      const hips = vrm.humanoid.getNormalizedBoneNode('hips')
      if (hips) hips.position.lerp(this.rootAnchor, smooth)
    }
    for (const [name, bone] of this.presentationBones) {
      const rotation = hand.get(name)
      if (rotation) bone.quaternion.copy(rotation)
    }
    this.captureBasePose()
  }

  private captureBasePose(): void {
    this.basePose = new Map(
      this.presentationBones.map(([, bone]) => [bone, bone.quaternion.clone()]),
    )
    this.baseRoot.copy(
      this.vrm?.humanoid.getNormalizedBoneNode('hips')?.position ?? this.rootAnchor,
    )
  }

  private limitStandingRootY(requested: number, seconds: number): number {
    const hips = this.vrm?.humanoid.getNormalizedBoneNode('hips')
    if (!hips) return requested
    const parent = hips.parent
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion(),
    )
    const scale = Math.max(0.001, Math.abs(parent?.getWorldScale(new THREE.Vector3()).y ?? 1))
    let result = requested
    for (const leg of this.plantedFeet) {
      const origin = leg.upper
        .getWorldPosition(new THREE.Vector3())
        .addScaledVector(up, (this.rootAnchor.y - hips.position.y) * scale)
      const a = leg.upper
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(leg.lower.getWorldPosition(new THREE.Vector3()))
      const b = leg.lower
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(leg.foot.getWorldPosition(new THREE.Vector3()))
      if (a < 0.001 || b < 0.001) continue
      const bend = (value: number): number => {
        const distance = origin
          .clone()
          .addScaledVector(up, (value - this.rootAnchor.y) * scale)
          .distanceTo(leg.target)
        return Math.acos(
          THREE.MathUtils.clamp((distance * distance - a * a - b * b) / (2 * a * b), -1, 1),
        )
      }
      const before = bend(this.filteredRootY),
        after = bend(result)
      const change = 0.9 * seconds
      if (Math.abs(after - before) <= change) continue
      const angle = before + Math.sign(after - before) * change
      const distanceSquared = a * a + b * b + 2 * a * b * Math.cos(angle)
      const delta = origin.clone().sub(leg.target)
      const height = delta.dot(up)
      const horizontalSquared = Math.max(0, delta.lengthSq() - height * height)
      const allowed =
        this.rootAnchor.y +
        (Math.sqrt(Math.max(0, distanceSquared - horizontalSquared)) - height) / scale
      result = THREE.MathUtils.clamp(
        allowed,
        Math.min(this.filteredRootY, result),
        Math.max(this.filteredRootY, result),
      )
    }
    return result
  }

  private capturePresentation(): void {
    const hips = this.vrm?.humanoid.getNormalizedBoneNode('hips')
    if (this.lease)
      this.presentation = {
        lease: { ...this.lease },
        profileId: this.appliedProfileId,
        frame: this.cursor,
        composedAtMs: performance.now(),
        phaseId: this.appliedPhaseId,
        localRecovery: this.localRecovery,
        executionId: this.appliedExecutionId,
        outcome: this.appliedOutcome,
        bones: Object.fromEntries(
          this.presentationBones.map(([name, bone]) => [name, bone.quaternion.toArray()]),
        ),
        hipsPosition: hips?.position.toArray() ?? [0, 0, 0],
        chestPosition: this.vrm?.humanoid.getNormalizedBoneNode('chest')?.position.toArray(),
      }
  }

  private restoreSafePose(): void {
    for (const binding of this.bindings) binding.bone.quaternion.copy(binding.safe)
    for (const [name, bone] of this.presentationBones) {
      const rotation = this.safeHands.get(name)
      if (rotation) bone.quaternion.copy(rotation)
    }
    this.vrm?.humanoid.getNormalizedBoneNode('hips')?.position.copy(this.rootAnchor)
    if (this.presentationOnly)
      this.vrm?.humanoid.getNormalizedBoneNode('chest')?.position.copy(this.chestAnchor)
  }

  private pump(): void {
    if (
      !this.vrm ||
      !this.playing ||
      this.localRecovery ||
      this.inFlight ||
      this.presentationOnly ||
      this.rekeying
    )
      return
    if (!this.lease) {
      if (this.booting) return
      this.booting = true
      this.phase = 'loading'
      const epoch = this.localEpoch
      const previousCancellation = this.cancellation
      this.startup = previousCancellation
        .then(() => {
          if (epoch !== this.localEpoch || !this.vrm) return null
          return window.api.motion.start({
            seed: this.context?.seed,
            profileId: this.profileId,
            avatarGeneration: this.avatarGeneration,
          })
        })
        .then(async (result) => {
          if (!result) return
          if (!result.ok) throw new Error(result.error)
          if (epoch !== this.localEpoch || !this.vrm) {
            await window.api.motion.stop(result.lease)
            return
          }
          this.lease = result.lease
          this.phase = 'loading'
          this.phaseWallStarted = performance.now()
          this.cursor = 0
          this.generatedEnd = 0
        })
        .catch((error) => {
          if (epoch === this.localEpoch) this.fail(error)
        })
        .finally(() => {
          this.booting = false
          this.startup = null
          if (this.lease) this.pump()
        })
      return
    }
    if (!this.execution) return
    if (this.execution.wantsRecovery && this.forecast) return
    const epoch = this.localEpoch,
      version = this.profileVersion,
      lease = this.lease
    const profileId = this.profileId
    let fromFrame = this.replan
      ? (this.replanFrom ?? Math.floor(this.cursor / 4) * 4)
      : this.generatedEnd
    let plan = this.plan()
    const nextPlan = this.execution.forecastPlan(`${lease.sessionId}:${this.localEpoch}`)
    // A long SOMA horizon can already cover the next phase boundary even while
    // the queue has ample motion. Forecast that boundary before the normal
    // prefetch threshold or short phases expire before their replacement arrives.
    const remaining =
      Math.max(0, this.execution.budget.minMs - this.execution.elapsedMs) / (1000 / 30)
    const boundary =
      this.forecast?.startFrame ?? Math.ceil((this.cursor + remaining - 0.000001) / 4) * 4
    if (
      this.generatedEnd - this.cursor >= 36 &&
      !this.replan &&
      !(nextPlan && this.generatedEnd >= boundary)
    )
      return
    if (!this.replan && nextPlan) {
      if (this.generatedEnd >= boundary) {
        if (!this.forecast) {
          this.forecast = { phaseId: nextPlan.phaseId, startFrame: boundary }
          fromFrame = boundary
          // Replace only the unconsumed suffix of the old steering plan. A
          // straddling horizon remains available as the physical lead-in.
          this.queue = this.queue.filter((queued) => queued.startFrame < boundary)
          const tail = this.queue.at(-1)
          this.generatedEnd = tail ? tail.startFrame + 60 : Math.floor(this.cursor)
        }
        plan = nextPlan
      }
    }
    if (this.queue.length >= 2) return
    this.replan = false
    this.replanFrom = null
    this.inFlight = true
    this.inFlightPhase = plan.phaseId
    void window.api.motion
      .next({ lease, profileId, fromFrame, plan })
      .then((result) => {
        if (epoch !== this.localEpoch || !this.vrm) return
        if (!result.ok) throw new Error(result.error)
        const chunk = motionChunkSchema.parse(result.chunk)
        if (
          chunk.epoch !== lease.epoch ||
          chunk.sessionId !== lease.sessionId ||
          chunk.modelGeneration !== lease.modelGeneration ||
          chunk.seed !== lease.seed ||
          chunk.profileId !== profileId ||
          chunk.startFrame !== fromFrame ||
          chunk.fromFrame !== fromFrame ||
          chunk.avatarGeneration !== lease.avatarGeneration ||
          JSON.stringify(chunk.plan) !== JSON.stringify(plan)
        )
          throw new Error('ARDY_STALE_CHUNK')
        this.lastInferenceMs = chunk.inferenceMs
        if (version !== this.profileVersion) {
          this.replan = true
          return
        }
        if (this.started && chunk.startFrame + 60 <= this.cursor) {
          this.lateChunks += 1
          this.replan = true
          return
        }
        // Keep the displayed horizon while preparing a transition. Replace only
        // future overlapping horizons; a straddling old chunk covers the lead-in.
        this.queue = this.queue.filter((queued) => queued.startFrame < chunk.startFrame)
        if (this.queue.length >= 2) throw new Error('ARDY_HORIZON_OVERFLOW')
        this.queue.push(chunk)
        this.generatedEnd = chunk.startFrame + 60
        this.phase = 'ready'
        if (!this.started) {
          this.cursor = chunk.startFrame
          this.started = true
        }
        if (this.readiness && chunk.profileId === this.profileId) {
          this.readiness.resolve()
          this.readiness = null
        }
      })
      .catch((error) => {
        if (epoch === this.localEpoch) this.fail(error)
      })
      .finally(() => {
        this.inFlight = false
        this.inFlightPhase = null
      })
  }

  private fail(error: unknown): void {
    const code = error instanceof Error ? error.message : 'ARDY_FAILED'
    this.stopAnimation(code)
    if (this.execution) this.execution.outcome = 'failed'
    this.presentation = null
    this.error = code
    this.phase = 'degraded'
    this.playing = false
    this.queue.length = 0
    this.readiness?.reject(new Error(this.error))
    this.readiness = null
    // Preserve the valid body pose during failure.
  }

  isAnimationPlaying(): boolean {
    if (this.presentationOnly) return this.mirror !== null
    // A temporary horizon underrun is not completion of the semantic action.
    // Queue advancement must wait for oneShotEnd, cancellation or a hard failure.
    return this.playing && this.started
  }

  getBodyMotionDebugState(): GeneratedBodyDebugState {
    const pose = this.presentationOnly ? this.mirror : this.presentation
    const transitionDuration = this.presentationOnly
      ? this.mirror
        ? this.mirrorDuration
        : 0
      : this.playing
        ? this.transitionDuration
        : 0
    const transitionElapsed = this.presentationOnly ? this.mirrorElapsed : this.transitionElapsed
    return {
      generated: {
        error: this.error?.slice(0, 128) ?? null,
        state:
          this.phase === 'ready' ||
          this.phase === 'degraded' ||
          this.phase === 'loading' ||
          this.phase === 'stopped' ||
          this.phase === 'mirror'
            ? this.phase
            : 'unavailable',
        queueFrames: this.queue.reduce((sum, chunk) => sum + chunk.rotations.length, 0),
        lateChunks: this.lateChunks,
        inferenceMs: this.lastInferenceMs,
        epoch: this.localEpoch,
        seed: this.lease?.seed ?? null,
        planning: {
          phaseId: this.execution?.phase ?? null,
          appliedPhaseId: this.appliedPhaseId,
          inFlightPhaseId: this.inFlightPhase,
          forecastPhaseId: this.forecast?.phaseId ?? null,
          progress: this.execution?.progress ?? 0,
          phaseAgeMs: Math.min(120000, Math.max(0, performance.now() - this.phaseWallStarted)),
          sourceFrame: Math.max(0, this.cursor),
          generatedEnd: Math.max(0, this.generatedEnd),
          localRecovery: this.localRecovery,
          recoveryBlockedBy: this.localRecovery ? this.recoveryBlocker() : null,
        },
        safety: this.bodySafety.getDebugState(),
      },
      motionExecution: this.getLibraryDebug(),
      generatedTrace: this.generatedTrace.map((entry) => ({ ...entry })),
      presentationMode: this.presentationOnly ? 'mirror' : 'primary',
      appliedPose:
        pose && this.vrm
          ? {
              profileId: pose.profileId,
              executionId: pose.executionId ?? null,
              phaseId: pose.phaseId ?? null,
              sourceFrame: pose.frame,
              outcome: pose.outcome ?? null,
            }
          : null,
      activeExecutionCount: this.playing && !this.presentationOnly ? 1 : 0,
      poseOwnerCount:
        this.vrm && (this.presentationOnly ? this.mirror : this.appliedExecutionId) ? 1 : 0,
      avatarGeneration: this.avatarGeneration,
      executionsStarted: this.executionSeq,
      sourceTimeSeconds: this.cursor / 30,
      transitionDuration,
      transitionRemaining: Math.max(0, transitionDuration - transitionElapsed),
      hipsDeltaY:
        (this.vrm?.humanoid.getNormalizedBoneNode('hips')?.position.y ?? this.rootAnchor.y) -
        this.rootAnchor.y,
      maxHipsDeltaY: this.maxHipsDeltaY,
    }
  }
}
