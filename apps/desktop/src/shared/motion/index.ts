import { z } from 'zod'

import rawCatalog from '../../../motion/motion-profiles.json'
import { conversationPerformanceSchema } from '../character-response/embodiment'
import { deliveryStyleSchema } from '../embodiment/deliveryStyle'
import { facialActingPresentationSchema } from '../facial-acting'
import { MOTION_PROFILE_IDS } from './catalog.generated'
import { motionCatalogSchema, motionPhaseSchema } from './catalogSchema'
import { DANCE_HORIZON_FRAMES, danceStyleSchema } from './physicalAction'

export * from './catalog.generated'
export * from './catalogSchema'
export * from './physicalAction'
export const MOTION_CATALOG = motionCatalogSchema.parse(rawCatalog)
export const MOTION_CATALOG_REVISION = MOTION_CATALOG.catalogRevision
export const FLASH_MOTION_FORMAT = MOTION_CATALOG.flashMotionFormat
export const MOTION_INFERENCE_DEADLINE_MS = 2500

export const MOTION_PROFILES = MOTION_CATALOG.profiles
export const motionProfileSchema = z.enum(MOTION_PROFILE_IDS)
export function getMotionProfile(id: string) {
  return MOTION_PROFILES.find((profile) => profile.id === id)
}
const identity = z.number().int().min(0).max(2_147_483_647)
export const motionPlanIdentitySchema = z
  .object({
    executionId: z.string().min(1).max(128),
    planRevision: identity,
    catalogRevision: z.literal(MOTION_CATALOG_REVISION),
    phaseId: motionPhaseSchema,
    handScoreRevision: z.string().min(1).max(80),
    handRigCalibrationRevision: z.literal('vrm-normalized-hands-v1'),
    clockDomain: z.enum(['local', 'speech']),
    playbackId: z.string().min(1).max(128).nullable(),
    continuityAnchor: z.string().min(1).max(128),
    danceStyle: danceStyleSchema.optional(),
  })
  .strict()
  .refine(
    (p) => (p.clockDomain === 'speech') === (p.playbackId !== null),
    'Speech clock requires exact playback identity',
  )
export type MotionPlanIdentity = z.infer<typeof motionPlanIdentitySchema>
export const flashMotionReadySchema = z
  .object({
    type: z.literal('ready'),
    catalogRevision: z.literal(MOTION_CATALOG_REVISION),
    protocolVersion: z.literal(1),
    sourceRevision: z.literal(FLASH_MOTION_FORMAT.sourceRevision),
    weightsRevision: z.literal(FLASH_MOTION_FORMAT.weightsRevision),
  })
  .strict()
export const motionLeaseSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    epoch: identity,
    modelGeneration: identity,
    avatarGeneration: identity,
    seed: identity,
  })
  .strict()
export type MotionLease = z.infer<typeof motionLeaseSchema>
export const motionSeedSchema = identity
export const motionVariationSchema = z
  .object({ lease: motionLeaseSchema, seed: motionSeedSchema.optional() })
  .strict()
export const motionStopSchema = z.union([
  motionLeaseSchema,
  z.object({ avatarGeneration: identity }).strict(),
])
export const motionStartSchema = z
  .object({
    profileId: motionProfileSchema,
    avatarGeneration: identity,
    seed: identity.optional(),
  })
  .strict()
export const motionProsodySchema = z
  .object({
    throughSample: z
      .number()
      .int()
      .min(0)
      .max(2 ** 48),
    sampleRate: z.number().int().min(8000).max(192000),
    envelope: z.array(z.number().finite().min(0).max(1)).min(1).max(12),
    phase: z.enum(['onset', 'speech', 'pause']),
    accent: z.number().finite().min(0).max(1),
    leadMs: z.number().finite().min(0).max(4000),
    available: z
      .object({
        startSample: z
          .number()
          .int()
          .min(0)
          .max(2 ** 48),
        stepSamples: z.number().int().min(1).max(9600),
        energy: z.array(z.number().finite().min(0).max(1)).min(1).max(30),
        /** Pitch accent per energy bin from submitted-PCM analysis. */
        accent: z.array(z.number().finite().min(0).max(1)).min(1).max(30).optional(),
        finalSample: z
          .number()
          .int()
          .min(0)
          .max(2 ** 48)
          .nullable(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.available ||
      (value.available.stepSamples <= value.sampleRate * 0.05 + 1 &&
        Math.abs(value.available.startSample - value.throughSample) <= value.sampleRate &&
        (value.available.finalSample === null ||
          value.available.finalSample >= value.available.startSample) &&
        (value.available.accent === undefined ||
          value.available.accent.length === value.available.energy.length)),
    'Invalid available PCM context',
  )
export type MotionProsody = z.infer<typeof motionProsodySchema>
export const motionActivitySchema = z
  .object({
    energy: z.number().finite().min(0).max(1),
    playbackId: z.string().min(1).max(128).nullable(),
    speaking: z.boolean(),
    sourceStartSample: z.number().int().min(0).max(26_460_000).optional(),
    prosody: motionProsodySchema.optional(),
    /** Bounded delivery style of the audible segment; absent outside speech. */
    style: deliveryStyleSchema.optional(),
  })
  .strict()
  .refine(
    (value) => !value.prosody || value.playbackId !== null,
    'Prosody requires playback identity',
  )
export type MotionActivity = z.infer<typeof motionActivitySchema>
export const motionNextSchema = z
  .object({
    lease: motionLeaseSchema,
    profileId: motionProfileSchema,
    fromFrame: identity.optional(),
    plan: motionPlanIdentitySchema,
    activity: motionActivitySchema.optional(),
  })
  .strict()
const finite = z.number().finite()
const quaternion = z.tuple([finite, finite, finite, finite]).refine((q) => {
  const norm = Math.hypot(...q)
  return norm >= 0.99 && norm <= 1.01
}, 'Invalid normalized quaternion')
const point = z.tuple([finite, finite, finite]).refine((p) => p.every((n) => Math.abs(n) <= 10))
export const motionChunkSchema = motionLeaseSchema
  .extend({
    type: z.literal('motion'),
    id: identity,
    reset: z.boolean(),
    fromFrame: identity,
    profileId: motionProfileSchema,
    skeleton: z.literal(FLASH_MOTION_FORMAT.skeleton),
    sourceProvider: z.literal('flashmotion').optional(),
    fps: z.literal(30),
    startFrame: identity,
    rotations: z.array(z.array(quaternion).length(30)).min(8).max(DANCE_HORIZON_FRAMES),
    flashMotion: z
      .object({
        weightsRevision: z.literal(FLASH_MOTION_FORMAT.weightsRevision),
        mode: z.enum(['t2m', 's2g']),
        speech: z
          .object({
            playbackId: z.string().min(1).max(128),
            startSample: z.number().int().min(0).max(26_460_000),
            frames: z.number().int().min(1).max(60),
          })
          .strict()
          .optional(),
        fingers: z.array(z.array(quaternion).length(30)).min(8).max(60).optional(),
        danceFeet: z
          .array(z.tuple([point, point]))
          .length(DANCE_HORIZON_FRAMES)
          .optional(),
      })
      .strict()
      .optional(),
    rootPositions: z.array(point).min(8).max(DANCE_HORIZON_FRAMES),
    footContacts: z
      .array(
        z
          .object({
            leftHeel: finite.min(0).max(1),
            leftToe: finite.min(0).max(1),
            rightHeel: finite.min(0).max(1),
            rightToe: finite.min(0).max(1),
          })
          .strict(),
      )
      .min(8)
      .max(DANCE_HORIZON_FRAMES),
    plan: motionPlanIdentitySchema,
    protocolVersion: z.literal(2),
    inferenceMs: finite.min(0).max(120_000),
    timings: z
      .object({
        planningMs: finite.min(0).max(120000),
        generationMs: finite.min(0).max(120000),
        conversionMs: finite.min(0).max(120000),
        handMs: finite.min(0).max(120000),
        endpointFrames: z.number().int().min(0).max(57),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((chunk) => {
    const frames = chunk.rotations.length
    if (
      frames % 4 !== 0 ||
      chunk.rootPositions.length !== frames ||
      chunk.footContacts.length !== frames
    )
      return false
    const flash = chunk.flashMotion
    if (chunk.profileId === 'dance_in_place')
      return (
        frames === DANCE_HORIZON_FRAMES &&
        !!chunk.plan.danceStyle &&
        chunk.plan.clockDomain === 'local' &&
        chunk.plan.phaseId === 'prepare' &&
        chunk.sourceProvider === 'flashmotion' &&
        flash?.mode === 't2m' &&
        !!flash.danceFeet &&
        !flash.speech &&
        !flash.fingers
      )
    if (flash?.danceFeet || chunk.plan.danceStyle || frames > 60) return false
    if (!flash) return frames === 60
    if (chunk.sourceProvider !== 'flashmotion') return false
    if (flash.mode === 't2m') return !flash.speech && !flash.fingers
    return Boolean(
      flash.speech?.frames === frames &&
        flash.fingers?.length === frames &&
        chunk.plan.clockDomain === 'speech' &&
        flash.speech.playbackId === chunk.plan.playbackId,
    )
  }, 'Invalid FlashMotion source or channel identity')
export type MotionChunk = z.infer<typeof motionChunkSchema>
export const generatedMotionHealthSchema = z
  .object({
    error: z.string().max(128).nullable(),
    state: z.enum(['unavailable', 'loading', 'ready', 'degraded', 'stopped', 'mirror']),
    queueFrames: z.number().int().min(0).max(120),
    lateChunks: z.number().int().nonnegative(),
    inferenceMs: z.number().finite().min(0).max(120000),
    epoch: identity,
    seed: identity.nullable(),
    flashMotion: z
      .object({
        weightsRevision: z.literal(FLASH_MOTION_FORMAT.weightsRevision),
        mode: z.enum(['t2m', 's2g']).nullable(),
        appliedSpeechSample: z.number().int().min(0).max(26_460_000).nullable(),
        fingers: z.enum(['native', 'profile-constraint', 'neutral']).optional(),
        performance: conversationPerformanceSchema.optional(),
      })
      .strict()
      .optional(),
    physical: z
      .object({
        executionId: z.string().min(1).max(128),
        generator: z.enum(['procedural', 'flashmotion']),
        direction: z.enum(['clockwise', 'counterclockwise']).optional(),
        danceStyle: danceStyleSchema.optional(),
        actionHeading: finite.min(-7).max(7),
        support: z.enum(['left', 'right', 'double']),
        steps: finite.int().min(0).max(24),
        maxRootSpeedMps: finite.min(0).max(100),
        maxRootAccelerationMps2: finite.min(0).max(10000),
        maxSupportDriftM: finite.min(0).max(10),
        outcome: z.enum(['completed', 'superseded', 'cancelled', 'timed-out', 'failed']).nullable(),
      })
      .strict()
      .refine((value) =>
        value.generator === 'procedural'
          ? !!value.direction && !value.danceStyle
          : !!value.danceStyle && !value.direction,
      )
      .optional(),
    planning: z
      .object({
        phaseId: motionPhaseSchema.nullable(),
        appliedPhaseId: motionPhaseSchema.nullable(),
        inFlightPhaseId: motionPhaseSchema.nullable(),
        forecastPhaseId: motionPhaseSchema.nullable(),
        progress: finite.min(0).max(1),
        phaseAgeMs: finite.min(0).max(120000),
        sourceFrame: finite.min(0).max(2147483647),
        generatedEnd: finite.min(0).max(2147483647),
        localRecovery: z.boolean(),
        recoveryBlockedBy: z.enum(['hands', 'arms', 'root', 'feet']).nullable().optional(),
      })
      .strict()
      .optional(),
    safety: z
      .object({
        // Two elbows, two knees and two wrists; each contributes once per frame.
        jointCorrections: z.number().int().min(0).max(6),
        armCorrections: z.number().int().min(0).max(2),
        unresolvedArmContacts: z.number().int().min(0).max(2).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type GeneratedMotionHealth = z.infer<typeof generatedMotionHealthSchema>
export const HAND_BONE_NAMES = [
  'leftThumbMetacarpal',
  'leftThumbProximal',
  'leftThumbDistal',
  'leftIndexProximal',
  'leftIndexIntermediate',
  'leftIndexDistal',
  'leftMiddleProximal',
  'leftMiddleIntermediate',
  'leftMiddleDistal',
  'leftRingProximal',
  'leftRingIntermediate',
  'leftRingDistal',
  'leftLittleProximal',
  'leftLittleIntermediate',
  'leftLittleDistal',
  'rightThumbMetacarpal',
  'rightThumbProximal',
  'rightThumbDistal',
  'rightIndexProximal',
  'rightIndexIntermediate',
  'rightIndexDistal',
  'rightMiddleProximal',
  'rightMiddleIntermediate',
  'rightMiddleDistal',
  'rightRingProximal',
  'rightRingIntermediate',
  'rightRingDistal',
  'rightLittleProximal',
  'rightLittleIntermediate',
  'rightLittleDistal',
] as const
export const BODY_BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  ...HAND_BONE_NAMES,
] as const
/** Composed procedural head/neck, mirrored so Overlay never runs a second head actor. */
export const HEAD_PRESENTATION_BONE_NAMES = ['neck', 'head'] as const
const avatarLookAtModeSchema = z.enum([
  'idle',
  'speaking',
  'listening',
  'thinking',
  'userFocus',
  'screenFocus',
  'away',
])
export type AvatarLookAtMode = z.infer<typeof avatarLookAtModeSchema>
const bodyPresentationBaseSchema = z
  .object({
    lease: motionLeaseSchema.nullable(),
    compositionSource: z.literal('local').optional(),
    localGeneration: z.number().int().min(1).max(2_147_483_647).optional(),
    profileId: motionProfileSchema,
    frame: finite.min(0).max(2_147_483_647),
    composedAtMs: finite.min(0).max(1_000_000_000_000).optional(),
    phaseId: motionPhaseSchema.optional(),
    localRecovery: z.boolean().optional(),
    executionId: z.string().min(1).max(128).optional(),
    outcome: z
      .enum(['completed', 'superseded', 'cancelled', 'timed-out', 'failed'])
      .nullable()
      .optional(),
    bones: z.partialRecord(z.enum(BODY_BONE_NAMES), quaternion),
    headBones: z.partialRecord(z.enum(HEAD_PRESENTATION_BONE_NAMES), quaternion).optional(),
    gazeMode: avatarLookAtModeSchema.optional(),
    hipsPosition: point,
    chestPosition: point.optional(),
    facialActing: facialActingPresentationSchema.optional(),
    stage: z
      .object({
        position: point,
        orientation: quaternion,
        continuousHeading: finite.min(-1000).max(1000),
        generator: z.enum(['procedural', 'flashmotion']),
      })
      .strict()
      .optional(),
  })
  .strict()
const validBodySource = (value: z.infer<typeof bodyPresentationBaseSchema>) =>
  value.lease
    ? value.compositionSource === undefined && value.localGeneration === undefined
    : value.compositionSource === 'local' &&
      value.localGeneration !== undefined &&
      value.frame === 0 &&
      value.executionId === undefined &&
      value.phaseId === undefined &&
      value.outcome === undefined &&
      value.localRecovery !== true
export const bodyPresentationSchema = bodyPresentationBaseSchema.refine(
  validBodySource,
  'Invalid body composition source',
)
export type BodyPresentation = z.infer<typeof bodyPresentationSchema>
export const bodyPresentationProjectionSchema = bodyPresentationBaseSchema
  .extend({
    modelAssetHandle: z.string().max(256),
  })
  .refine(validBodySource, 'Invalid body composition source')
export type BodyPresentationProjection = z.infer<typeof bodyPresentationProjectionSchema>
export type MotionStatus = {
  state:
    | 'unavailable'
    | 'loading'
    | 'warming'
    | 'ready'
    | 'generating'
    | 'stopping'
    | 'failed'
    | 'closed'
  error: string | null
  epoch: number
  modelGeneration: number
  session: MotionLease | null
  provider?: 'flashmotion'
  weightsRevision?: string
}
export type MotionReply = { ok: true; chunk: MotionChunk } | { ok: false; error: string }
export interface MotionApi {
  start(
    input: z.infer<typeof motionStartSchema>,
  ): Promise<{ ok: true; lease: MotionLease } | { ok: false; error: string }>
  next(input: z.infer<typeof motionNextSchema>): Promise<MotionReply>
  reroll(
    input: z.infer<typeof motionVariationSchema>,
  ): Promise<{ ok: true; lease: MotionLease } | { ok: false; error: string }>
  stop(lease: z.infer<typeof motionStopSchema>): Promise<{ ok: boolean }>
  status(): Promise<MotionStatus>
}
