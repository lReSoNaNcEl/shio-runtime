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

export const physicalActionProfileSchema = z
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
