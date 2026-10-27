import { z } from 'zod'

export const FACIAL_ACTING_CHANNELS = [
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'browDownLeft',
  'browDownRight',
  'eyeWideLeft',
  'eyeWideRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
] as const
export type FacialActingChannel = (typeof FACIAL_ACTING_CHANNELS)[number]
const weight = z.number().finite().min(0).max(1)
export const facialActingValuesSchema = z
  .object({
    browInnerUp: weight,
    browOuterUpLeft: weight,
    browOuterUpRight: weight,
    browDownLeft: weight,
    browDownRight: weight,
    eyeWideLeft: weight,
    eyeWideRight: weight,
    eyeSquintLeft: weight,
    eyeSquintRight: weight,
    mouthSmileLeft: weight,
    mouthSmileRight: weight,
    mouthFrownLeft: weight,
    mouthFrownRight: weight,
    mouthDimpleLeft: weight,
    mouthDimpleRight: weight,
  })
  .partial()
  .strict()
export type FacialActingValues = z.infer<typeof facialActingValuesSchema>
export const facialActingPresentationSchema = z
  .object({
    acting: facialActingValuesSchema,
    blinkLeft: weight,
    blinkRight: weight,
  })
  .strict()
export type FacialActingPresentation = z.infer<typeof facialActingPresentationSchema>
