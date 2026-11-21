import { z } from 'zod'

/** Semantic parameters only; no trajectories, joints, prompts or process authority. */
export const bodyTurnIntentSchema = z
  .object({
    action: z.literal('turn-in-place'),
    turns: z.literal(1),
    direction: z.enum(['clockwise', 'counterclockwise']),
    tempo: z.number().finite().min(0.75).max(1.2),
    finishFacing: z.literal('viewer'),
  })
  .strict()
export type BodyTurnIntent = z.infer<typeof bodyTurnIntentSchema>

export const danceStyleSchema = z.enum(['smooth', 'playful', 'energetic'])
export type DanceStyle = z.infer<typeof danceStyleSchema>
export const bodyDanceIntentSchema = z
  .object({
    action: z.literal('dance-in-place'),
    style: danceStyleSchema,
    tempo: z.number().finite().min(0.85).max(1.15),
  })
  .strict()
export type BodyDanceIntent = z.infer<typeof bodyDanceIntentSchema>
export const bodyActionIntentSchema = z.discriminatedUnion('action', [
  bodyTurnIntentSchema,
  bodyDanceIntentSchema,
])
export type BodyActionIntent = z.infer<typeof bodyActionIntentSchema>
export const bodyActionIdSchema = z.enum(['turn-in-place', 'dance-in-place'])
export const DANCE_HORIZON_FRAMES = 120

const turnProfile = z
  .object({
    action: z.literal('turn-in-place'),
    turns: z.literal(1),
    directions: z.tuple([z.literal('clockwise'), z.literal('counterclockwise')]),
    tempoMin: z.literal(0.75),
    tempoMax: z.literal(1.2),
    completion: z.tuple([
      z.literal('heading-reached'),
      z.literal('feet-grounded'),
      z.literal('standing-stable'),
    ]),
    interruption: z.literal('land-and-stabilize'),
    generator: z.literal('procedural'),
  })
  .strict()

export const physicalActionProfileSchema = z.discriminatedUnion('action', [
  turnProfile,
  z
    .object({
      action: z.literal('dance-in-place'),
      completion: z.tuple([z.literal('feet-grounded'), z.literal('standing-stable')]),
      interruption: z.literal('land-and-stabilize'),
      generator: z.literal('flashmotion'),
    })
    .strict(),
])
