import { describe, expect, it } from 'vitest'

import { EMBODIMENT_GESTURE_HINTS } from '../../../src/shared/character-response'
import {
  SafeCharacterStreamFilter,
  SpeechTextCommitBuffer,
} from '../../../src/shared/character-stream'
import { parseEmotionalReply } from '../../../src/shared/emotion'

function filtered(parts: readonly string[]) {
  const filter = new SafeCharacterStreamFilter()
  const deltas = [...parts.flatMap((part) => filter.push(part)), ...filter.flush()]
  return { filter, deltas, text: deltas.map((delta) => delta.text).join('') }
}

describe('gesture literal containment without execution authority', () => {
  it('contains canonical gesture tags at every boundary before chat and speech without creating intent', () => {
    for (const hint of EMBODIMENT_GESTURE_HINTS) {
      const source = `[happy]Смотри![${hint}]`
      for (const parts of [
        [...source],
        ...Array.from({ length: source.length + 1 }, (_, split) => [
          source.slice(0, split),
          source.slice(split),
        ]),
      ]) {
        const result = filtered(parts)
        expect(result.text, hint).toBe('Смотри!')
        expect(result.filter.takeEmbodimentIntents()).toEqual([])
        expect(result.deltas.every((delta) => delta.emotion === 'happy')).toBe(true)
        const buffer = new SpeechTextCommitBuffer('literal-containment')
        const speech = [...result.deltas.flatMap((delta) => buffer.push(delta)), ...buffer.flush()]
        expect(speech.map((item) => item.text).join(' ')).toBe('Смотри!')
      }
      expect(parseEmotionalReply(source).visibleText).toBe('Смотри!')
    }
  })

  it('preserves quoted, escaped, unknown and linked gesture labels at every split', () => {
    const source =
      '`[fox-paw]` \\[greeting] [unknown] [fox-paw](https://example.org) [greeting][guide]\n[guide]: https://example.org\n'
    for (const parts of [
      [...source],
      ...Array.from({ length: source.length + 1 }, (_, split) => [
        source.slice(0, split),
        source.slice(split),
      ]),
    ]) {
      expect(filtered(parts).text).toBe(source)
    }
  })
})
