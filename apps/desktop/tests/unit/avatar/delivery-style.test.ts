import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DELIVERY_STYLE_AXES,
  EMBODIMENT_STYLE_CONTRACT,
  moodDeliveryShift,
  NEUTRAL_DELIVERY_STYLE,
  resolveDeliveryStyle,
} from '../../../src/shared/embodiment'
import { SPEECH_EMOTIONS } from '../../../src/shared/speech'
import { desktopRoot } from '../../architecture/context'

const neutralMood = { valence: 0, arousal: 0, playfulness: 0.5, curiosity: 0.55, frustration: 0 }

describe('delivery style', () => {
  it('resolves every canonical emotion to bounded axes', () => {
    for (const emotion of SPEECH_EMOTIONS) {
      const style = resolveDeliveryStyle(emotion)
      expect(Object.keys(style).sort()).toEqual([...DELIVERY_STYLE_AXES].sort())
      for (const axis of DELIVERY_STYLE_AXES) {
        const [low, high] = EMBODIMENT_STYLE_CONTRACT.axes[axis]
        expect(style[axis]).toBeGreaterThanOrEqual(low)
        expect(style[axis]).toBeLessThanOrEqual(high)
      }
    }
  })

  it('separates joyful from sad delivery on height and tempo', () => {
    const happy = resolveDeliveryStyle('happy')
    const sad = resolveDeliveryStyle('sad')
    expect(happy.height - sad.height).toBeGreaterThan(0.4)
    expect(resolveDeliveryStyle('excited').tempo).toBeGreaterThan(
      resolveDeliveryStyle('calm').tempo * 1.2,
    )
  })

  it('falls back to neutral for an unknown emotion', () => {
    expect(resolveDeliveryStyle('not-an-emotion')).toEqual({ ...NEUTRAL_DELIVERY_STYLE })
  })

  it('scales the deviation from neutral by intensity', () => {
    const subtle = resolveDeliveryStyle('happy', 'subtle')
    const normal = resolveDeliveryStyle('happy', 'normal')
    const strong = resolveDeliveryStyle('happy', 'strong')
    expect(subtle.height).toBeLessThan(normal.height)
    expect(strong.height).toBeGreaterThan(normal.height)
  })

  it('bounds the Mood modulation of every axis and keeps a neutral mood inert', () => {
    expect(resolveDeliveryStyle('warm', 'normal', neutralMood)).toEqual(
      resolveDeliveryStyle('warm'),
    )
    const extreme = { valence: 1, arousal: 1, playfulness: 1, curiosity: 1, frustration: 1 }
    const shift = moodDeliveryShift(extreme)
    for (const axis of DELIVERY_STYLE_AXES) expect(Math.abs(shift[axis])).toBeLessThanOrEqual(0.15)
    const low = moodDeliveryShift({ ...neutralMood, arousal: -1 })
    expect(low.tempo).toBeLessThan(0)
    expect(moodDeliveryShift({ ...neutralMood, arousal: 1 }).tempo).toBeGreaterThan(0)
  })

  it('ignores non-finite Mood dimensions', () => {
    const style = resolveDeliveryStyle('neutral', 'normal', { ...neutralMood, valence: Number.NaN })
    expect(style).toEqual({ ...NEUTRAL_DELIVERY_STYLE })
  })

  it('keeps generated TS and worker artifacts in sync with the contract', () => {
    const repository = join(desktopRoot, '..', '..')
    const contract = JSON.parse(
      readFileSync(join(repository, 'contracts', 'embodiment-style.v1.json'), 'utf8'),
    )
    const worker = JSON.parse(
      readFileSync(join(desktopRoot, 'motionbricks', 'embodiment_style.json'), 'utf8'),
    )
    expect(EMBODIMENT_STYLE_CONTRACT.default).toEqual(contract.default)
    expect(EMBODIMENT_STYLE_CONTRACT.mood).toEqual(contract.mood)
    expect(worker).toEqual({
      schemaVersion: contract.schemaVersion,
      axes: contract.axes,
      default: contract.default,
    })
  })
})
