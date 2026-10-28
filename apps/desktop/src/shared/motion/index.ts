import { z } from 'zod'

import rawCatalog from '../../../motion/motion-profiles.json'
import { facialActingPresentationSchema } from '../facial-acting'
import { MOTION_PROFILE_IDS } from './catalog.generated'
import { motionCatalogSchema, motionFormatSchema, motionPhaseSchema } from './catalogSchema'

export * from './catalog.generated'
export * from './catalogSchema'
export * from './physicalAction'
export const MOTION_CATALOG = motionCatalogSchema.parse(rawCatalog)
export const MOTION_CATALOG_REVISION = MOTION_CATALOG.catalogRevision
export const MOTION_FORMAT = MOTION_CATALOG.format
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
  })
  .strict()
  .refine(
    (p) => (p.clockDomain === 'speech') === (p.playbackId !== null),
    'Speech clock requires exact playback identity',
  )
export type MotionPlanIdentity = z.infer<typeof motionPlanIdentitySchema>
export const motionReadySchema = z
  .object({
    type: z.literal('ready'),
    catalogRevision: z.literal(MOTION_CATALOG_REVISION),
    handModelRevision: z
      .literal('233e9225c1da05c6a3dd98107b9f027f2366e3b972bbe67e0d164e5d28619fff')
      .optional(),
    format: z.union([
      motionFormatSchema,
      motionFormatSchema.extend({
        sourceRevision: z.literal('54fc563aeaaf819a753d72cc9fdc6713989cdd43'),
        modelRevision: z.literal(
          '6c9f78e23decbda8e1cfd1b0cc96980ea4b24b3ca2c808d03b058f48f82fc9ef',
        ),
      }),
    ]),
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
export const motionActivitySchema = z
  .object({
    energy: z.number().finite().min(0).max(1),
    playbackId: z.string().min(1).max(128).nullable(),
    speaking: z.boolean(),
  })
  .strict()
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
    skeleton: z.literal('soma30-standard-tpose-v1'),
    sourceProvider: z.enum(['ardy', 'motionbricks']).optional(),
    fps: z.literal(30),
    startFrame: identity,
    rotations: z.array(z.array(quaternion).length(30)).length(60),
    handDeltas: z
      .object({
        modelRevision: z.literal(
          '233e9225c1da05c6a3dd98107b9f027f2366e3b972bbe67e0d164e5d28619fff',
        ),
        basis: z.object({ left: quaternion, right: quaternion }).strict(),
        rotations: z.array(z.array(quaternion).length(30)).length(60),
      })
      .strict()
      .optional(),
    rootPositions: z.array(point).length(60),
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
      .length(60),
    plan: motionPlanIdentitySchema,
    protocolVersion: z.literal(2),
    inferenceMs: finite.min(0).max(120_000),
  })
  .strict()
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
    physical: z
      .object({
        executionId: z.string().min(1).max(128),
        generator: z.literal('procedural'),
        direction: z.enum(['clockwise', 'counterclockwise']),
        actionHeading: finite.min(-7).max(7),
        support: z.enum(['left', 'right', 'double']),
        steps: finite.int().min(0).max(24),
        maxRootSpeedMps: finite.min(0).max(100),
        maxRootAccelerationMps2: finite.min(0).max(10000),
        maxSupportDriftM: finite.min(0).max(10),
        outcome: z.enum(['completed', 'superseded', 'cancelled', 'timed-out', 'failed']).nullable(),
      })
      .strict()
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
    hipsPosition: point,
    chestPosition: point.optional(),
    facialActing: facialActingPresentationSchema.optional(),
    stage: z
      .object({
        position: point,
        orientation: quaternion,
        continuousHeading: finite.min(-1000).max(1000),
        generator: z.literal('procedural'),
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
