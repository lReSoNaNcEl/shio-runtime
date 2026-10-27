import { z } from 'zod'

import { EMBODIMENT_GESTURE_HINTS } from '../character-response/embodiment'

export const MOTION_PHASE_IDS = ['prepare', 'stroke', 'hold', 'recover'] as const
export const motionPhaseSchema = z.enum(MOTION_PHASE_IDS)
export type MotionPhaseId = z.infer<typeof motionPhaseSchema>
export const motionHandZoneSchema = z.enum([
  'relaxed',
  'front',
  'raised',
  'heart',
  'side',
  'waist',
  'face',
])
const finite = z.number().finite()
const boundedId = z
  .string()
  .regex(/^[a-z0-9_-]+$/)
  .min(1)
  .max(80)
const labels = z.object({ ru: z.string().min(1).max(600), en: z.string().min(1).max(600) }).strict()
const finger = z
  .object({
    curl: z.tuple([finite.min(0).max(1.4), finite.min(0).max(1.4), finite.min(0).max(1.4)]),
    spread: finite.min(-0.35).max(0.35),
    opposition: finite.min(0).max(1.2),
  })
  .strict()
export const motionHandTargetSchema = z
  .object({
    role: z.enum(['lead', 'support', 'bilateral']),
    workspace: motionHandZoneSchema,
    palmFacing: z.enum(['free', 'forward', 'up', 'inward']),
    fingerDirection: z.enum(['free', 'up', 'forward']),
    timing: z
      .object({ start: finite.min(0).max(0.95), end: finite.min(0.05).max(1) })
      .strict()
      .refine((t) => t.end - t.start >= 0.05, 'Hand phase curve needs a positive bounded interval'),
    wristEuler: z.tuple([
      finite.min(-0.5).max(0.5),
      finite.min(-0.5).max(0.5),
      finite.min(-0.5).max(0.5),
    ]),
    fingers: z
      .object({ thumb: finger, index: finger, middle: finger, ring: finger, little: finger })
      .strict(),
  })
  .strict()
  .refine(
    (target) =>
      target.palmFacing === 'free' ||
      target.fingerDirection === 'free' ||
      (target.palmFacing === 'up'
        ? target.fingerDirection === 'forward'
        : target.fingerDirection === 'up'),
    'Palm normal and finger direction must be perpendicular',
  )
export type MotionHandTarget = z.infer<typeof motionHandTargetSchema>
const handPair = z.object({ left: motionHandTargetSchema, right: motionHandTargetSchema }).strict()
const phase = z
  .object({
    id: motionPhaseSchema,
    minMs: finite.int().min(50).max(45000),
    maxMs: finite.int().min(50).max(45000),
    exitConditions: z
      .array(
        z.enum([
          'both-hands-target-reached',
          'body-phase-ready',
          'standing-stable',
          'both-hands-recovered',
          'wrists-recovered',
          'fingers-recovered',
        ]),
      )
      .min(1)
      .max(6),
  })
  .strict()
  .refine((p) => p.maxMs >= p.minMs, 'Phase duration is inverted')
export const motionCatalogProfileSchema = z
  .object({
    id: boundedId,
    family: z.enum([
      'presence',
      'greeting',
      'farewell',
      'agreement',
      'disagreement',
      'explanation',
      'comparison',
      'invitation',
      'reassurance',
      'thanks',
      'presentation',
      'delight',
      'amusement',
      'shyness',
      'curiosity',
      'surprise',
      'concern',
      'resolve',
      'celebration',
      'playful',
      'affection',
      'rest',
    ]),
    kind: z.enum(['presence', 'gesture']),
    labels,
    descriptions: labels,
    description: z.string().min(1).max(600),
    semanticIntent: z.enum(EMBODIMENT_GESTURE_HINTS).nullable(),
    entryPostures: z.tuple([z.literal('standing')]),
    exitPosture: z.literal('standing'),
    requiredRigCapabilities: z
      .array(z.enum(['body-standing', 'left-hand', 'right-hand', 'left-fingers', 'right-fingers']))
      .length(5),
    supportPolicy: z
      .object({
        contacts: z.literal('both-feet-planted'),
        allowStep: z.literal(false),
        maxVerticalRootM: finite.min(0).max(0.02),
      })
      .strict(),
    rootPolicy: z
      .object({
        mode: z.literal('anchored-standing'),
        frame: z.literal('model-stage'),
        maxHorizontalM: finite.min(0).max(0.01),
      })
      .strict(),
    phases: z.array(phase).length(4),
    handScore: z
      .object({
        revision: boundedId,
        calibrationRevision: z.literal('vrm-normalized-hands-v1'),
        phases: z
          .object({ prepare: handPair, stroke: handPair, hold: handPair, recover: handPair })
          .strict(),
      })
      .strict(),
    entryHands: z.literal('relaxed'),
    accentHands: motionHandZoneSchema,
    exitHands: z.literal('relaxed'),
    cameraPolicy: z
      .array(z.enum(['full', 'bust', 'face']))
      .min(1)
      .max(3),
    interruptionPolicy: z
      .object({
        interruptiblePhases: z.array(motionPhaseSchema).max(4),
        recoveryRequired: z.literal(true),
        protectedPhase: z.literal('stroke'),
      })
      .strict(),
    variationPolicy: z
      .object({
        amplitudeMin: finite.min(0.5).max(1),
        amplitudeMax: finite.min(1).max(1.2),
        tempoMin: finite.min(0.5).max(1),
        tempoMax: finite.min(1).max(1.2),
        fixedLeadSide: z.literal('right'),
        mirrorQualified: z.literal(false),
        cooldownFamilyMs: finite.int().min(0).max(300000),
        intentTtlMs: finite.int().min(1000).max(10000),
      })
      .strict(),
    qualification: z
      .object({
        state: z.enum(['draft', 'qualified', 'disabled']),
        rigProfiles: z.array(z.literal('vrm-normalized-hands-v1')).length(1),
      })
      .strict(),
    conditioningRefs: z
      .object({ templateId: boundedId, prompt: z.string().min(1).max(600) })
      .strict(),
    behaviorTags: z.array(z.string().min(1).max(64)).max(8),
    usage: z
      .object({
        speaking: z.boolean(),
        reaction: z.boolean(),
        idle: z.boolean(),
        extendedIdle: z.boolean(),
      })
      .strict(),
    automaticSelection: z.boolean(),
    defaultWeight: finite.int().min(0).max(10),
    libraryGroup: z.enum(['presence', 'conversation', 'reactions', 'special']),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.phases.some((v, i) => v.id !== MOTION_PHASE_IDS[i]))
      ctx.addIssue({
        code: 'custom',
        message: 'Phases must appear exactly once in execution order',
      })
    const recover = p.phases[3]
    for (const condition of [
      'standing-stable',
      'both-hands-recovered',
      'wrists-recovered',
      'fingers-recovered',
    ]) {
      if (!recover?.exitConditions.includes(condition as (typeof recover.exitConditions)[number]))
        ctx.addIssue({
          code: 'custom',
          message: 'Recovery must cover body, both wrists and fingers',
        })
    }
    for (const side of ['left', 'right'] as const) {
      const recovery = p.handScore.phases.recover[side]
      if (
        recovery.wristEuler.some((v) => Math.abs(v) > 0.1) ||
        Object.values(recovery.fingers).some(
          (f) => f.curl.some((v) => v > 0.6) || Math.abs(f.spread) > 0.08 || f.opposition > 0.3,
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Relaxed exit requires released wrists and all fingers',
        })
      if (
        MOTION_PHASE_IDS.some(
          (phase) => p.handScore.phases[phase][side].role !== p.handScore.phases.prepare[side].role,
        )
      )
        ctx.addIssue({ code: 'custom', message: 'Hand roles are fixed for an execution' })
    }
    if (p.interruptionPolicy.interruptiblePhases.includes(p.interruptionPolicy.protectedPhase))
      ctx.addIssue({ code: 'custom', message: 'A protected stroke cannot also be interruptible' })
    if (!p.automaticSelection && p.defaultWeight !== 0)
      ctx.addIssue({ code: 'custom', message: 'Manual profile cannot carry automatic weight' })
    if (new Set(p.requiredRigCapabilities).size !== 5)
      ctx.addIssue({
        code: 'custom',
        message: 'Both calibrated hands and all fingers are required',
      })
  })
export type MotionProfile = z.infer<typeof motionCatalogProfileSchema>
export const motionFormatSchema = z
  .object({
    protocolVersion: z.literal(2),
    sourceRevision: z.literal('e706e27acc88070918308a10922b8f7174d0825e'),
    modelRevision: z.literal('244215084b22fcd29ab743017330e87411fe168a'),
    skeleton: z.literal('soma30-standard-tpose-v1'),
    referencePose: z.literal('standard-tpose'),
    quaternionOrder: z.literal('xyzw'),
    rotationSpace: z.literal('world'),
    axes: z
      .object({ up: z.literal('y'), forward: z.literal('z'), handedness: z.literal('right') })
      .strict(),
    units: z.literal('metres'),
    fps: z.literal(30),
    horizonFrames: z.literal(60),
    historyFrames: z.literal(60),
    contactOrder: z.tuple([
      z.literal('leftHeel'),
      z.literal('leftToe'),
      z.literal('rightHeel'),
      z.literal('rightToe'),
    ]),
  })
  .strict()
const edge = z.tuple([motionHandZoneSchema, motionHandZoneSchema])
export const motionCatalogSchema = z
  .object({
    schemaVersion: z.literal(2),
    catalogRevision: boundedId,
    format: motionFormatSchema,
    handRigCalibration: z
      .object({
        revision: z.literal('vrm-normalized-hands-v1'),
        rig: z.literal('vrm-normalized'),
        curlAxis: z.literal('z'),
        spreadAxis: z.literal('y'),
        thumbOppositionAxis: z.literal('x'),
        leftSign: z.literal(-1),
        rightSign: z.literal(1),
        maxCurl: z.literal(1.4),
        maxSpread: z.literal(0.35),
        maxOpposition: z.literal(1.2),
      })
      .strict(),
    handWorkspaces: z.record(
      motionHandZoneSchema,
      z
        .object({
          anchor: z.enum(['hips', 'chest', 'neck', 'head']),
          center: z.tuple([finite.min(0).max(1.2), finite.min(-1).max(1), finite.min(0).max(1.2)]),
          halfExtents: z.tuple([
            finite.min(0.02).max(0.5),
            finite.min(0.02).max(0.5),
            finite.min(0.02).max(0.5),
          ]),
        })
        .strict(),
    ),
    compositionMask: z.tuple([
      z.literal('hips'),
      z.literal('spine'),
      z.literal('chest'),
      z.literal('upperChest'),
      z.literal('shoulders'),
      z.literal('arms'),
      z.literal('wrists'),
      z.literal('fingers'),
      z.literal('legs'),
      z.literal('feet'),
    ]),
    transitionGraph: z
      .object({
        posture: z.literal('standing'),
        support: z.literal('both-feet-planted'),
        zones: z.array(motionHandZoneSchema).length(7),
        directEdges: z.array(edge).max(49),
        bridgeEdges: z.array(edge).max(49),
        preparationEdges: z.array(edge).min(1).max(7),
        recoveryEdges: z.array(edge).min(1).max(7),
        fallback: z.literal('recover-to-standing'),
      })
      .strict(),
    profiles: z.array(motionCatalogProfileSchema).min(1).max(64),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (new Set(c.profiles.map((p) => p.id)).size !== c.profiles.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate profile identity' })
    if (!c.profiles.some((p) => p.id === 'presence_poised' && p.kind === 'presence'))
      ctx.addIssue({ code: 'custom', message: 'Standing recovery presence is required' })
    const zones = new Set(c.transitionGraph.zones)
    if (zones.size !== 7)
      ctx.addIssue({ code: 'custom', message: 'Every standing hand zone must be unique' })
    for (const profile of c.profiles) {
      if (
        !c.transitionGraph.preparationEdges.some(
          ([from, to]) => from === 'relaxed' && to === profile.accentHands,
        ) ||
        !c.transitionGraph.recoveryEdges.some(
          ([from, to]) => from === profile.accentHands && to === 'relaxed',
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Every accent zone requires a reachable preparation and recovery',
        })
    }
    if (c.transitionGraph.directEdges.some(([from, to]) => from === 'raised' && to === 'heart'))
      ctx.addIssue({
        code: 'custom',
        message: 'Raised-hand to heart requires a bridge or full recovery',
      })
    for (const e of [
      ...c.transitionGraph.directEdges,
      ...c.transitionGraph.bridgeEdges,
      ...c.transitionGraph.preparationEdges,
      ...c.transitionGraph.recoveryEdges,
    ])
      if (!e.every((z) => zones.has(z)))
        ctx.addIssue({ code: 'custom', message: 'Unreachable transition zone' })
  })
