import { z } from 'zod'

import type { MoodState } from '../alive'
import { EMBODIMENT_STYLE_CONTRACT } from './embodimentStyle.generated'

/** Bounded body-delivery axes shared by renderer embodiment. */
export const DELIVERY_STYLE_AXES = [
  'openness',
  'height',
  'tempo',
  'sharpness',
  'asymmetry',
  'lean',
] as const
export type DeliveryStyleAxis = (typeof DELIVERY_STYLE_AXES)[number]
export type DeliveryStyle = Record<DeliveryStyleAxis, number>
export type DeliveryIntensity = keyof typeof EMBODIMENT_STYLE_CONTRACT.intensity
export type DeliveryMood = Pick<
  MoodState,
  'valence' | 'arousal' | 'playfulness' | 'curiosity' | 'frustration'
>

const AXES = EMBODIMENT_STYLE_CONTRACT.axes
const unit = z.number().finite().min(0).max(1)
export const deliveryStyleSchema = z
  .object({
    openness: unit,
    height: unit,
    tempo: unit,
    sharpness: unit,
    asymmetry: unit,
    lean: z.number().finite().min(AXES.lean[0]).max(AXES.lean[1]),
  })
  .strict()

export const NEUTRAL_DELIVERY_STYLE: Readonly<DeliveryStyle> = Object.freeze({
  ...EMBODIMENT_STYLE_CONTRACT.default,
})

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const round = (value: number) => Math.round(value * 1000) / 1000
const finiteOr = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** Bounded Mood contribution per axis; each axis moves by at most `mood.maxShift`. */
export function moodDeliveryShift(mood: DeliveryMood): DeliveryStyle {
  const { maxShift, centers, coefficients } = EMBODIMENT_STYLE_CONTRACT.mood
  const shift = {} as DeliveryStyle
  for (const axis of DELIVERY_STYLE_AXES) {
    const terms: Partial<Record<keyof DeliveryMood, number>> = coefficients[axis]
    let sum = 0
    for (const [dimension, coefficient] of Object.entries(terms) as Array<
      [keyof DeliveryMood, number]
    >)
      sum += coefficient * (finiteOr(mood[dimension], centers[dimension]) - centers[dimension])
    shift[axis] = clamp(sum, -maxShift, maxShift)
  }
  return shift
}

/** Pure: canonical emotion → bounded delivery style, optionally modulated by Mood.
 * Intensity scales the emotion's deviation from neutral; unknown emotions are neutral. */
export function resolveDeliveryStyle(
  emotionId: string,
  intensity: DeliveryIntensity = 'normal',
  mood?: DeliveryMood | null,
): DeliveryStyle {
  const emotions: Record<string, DeliveryStyle> = EMBODIMENT_STYLE_CONTRACT.emotions
  const base = emotions[emotionId.trim().toLowerCase()] ?? NEUTRAL_DELIVERY_STYLE
  const scale = EMBODIMENT_STYLE_CONTRACT.intensity[intensity] ?? 1
  const shift = mood ? moodDeliveryShift(mood) : null
  const style = {} as DeliveryStyle
  for (const axis of DELIVERY_STYLE_AXES) {
    const neutral = NEUTRAL_DELIVERY_STYLE[axis]
    const value = neutral + (base[axis] - neutral) * scale + (shift?.[axis] ?? 0)
    style[axis] = round(clamp(value, AXES[axis][0], AXES[axis][1]))
  }
  return style
}
