import { describe, expect, it } from 'vitest'

import {
  enMessages,
  messagePlaceholders,
  ruMessages,
  type TranslationKey,
  translate,
} from '../../src/shared/localization'

describe('Desktop localization contract', () => {
  it('keeps Russian and English dictionaries complete and placeholder-compatible', () => {
    const ruKeys = Object.keys(ruMessages).sort()
    const enKeys = Object.keys(enMessages).sort()
    expect(enKeys).toEqual(ruKeys)

    for (const key of ruKeys as TranslationKey[]) {
      expect(ruMessages[key].trim(), `RU message must not be empty: ${key}`).not.toBe('')
      expect(enMessages[key].trim(), `EN message must not be empty: ${key}`).not.toBe('')
      expect(messagePlaceholders(enMessages[key]), `Placeholder mismatch: ${key}`).toEqual(
        messagePlaceholders(ruMessages[key]),
      )
    }
  })

  it('translates messages with and without substitutions', () => {
    expect(translate('en', 'main.error.project.repositoryFormat')).toBe(
      'Repository must use owner/name format.',
    )
    expect(translate('ru', 'controller.overlay.applyFailed', { mode: 'portrait' })).toBe(
      'Не удалось применить режим portrait',
    )
  })
})
