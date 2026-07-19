import assert from 'node:assert/strict'

import {
  enMessages,
  messagePlaceholders,
  ruMessages,
  type TranslationKey,
  translate,
} from '../../src/shared/localization'

const ruKeys = Object.keys(ruMessages).sort()
const enKeys = Object.keys(enMessages).sort()

assert.deepEqual(enKeys, ruKeys, 'RU and EN dictionaries must contain exactly the same keys')

for (const key of ruKeys as TranslationKey[]) {
  const ru = ruMessages[key]
  const en = enMessages[key]

  assert.ok(ru.trim(), `RU message must not be empty: ${key}`)
  assert.ok(en.trim(), `EN message must not be empty: ${key}`)
  assert.deepEqual(
    messagePlaceholders(en),
    messagePlaceholders(ru),
    `RU and EN placeholders must match: ${key}`,
  )
}

assert.equal(
  translate('en', 'main.error.project.repositoryFormat'),
  'Repository must use owner/name format.',
)
assert.equal(
  translate('ru', 'controller.overlay.applyFailed', { mode: 'portrait' }),
  'Не удалось применить режим portrait',
)

console.log(`Localization repro passed: ${ruKeys.length} RU/EN messages`)
