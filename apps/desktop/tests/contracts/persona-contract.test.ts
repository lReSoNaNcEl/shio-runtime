import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SYSTEM_PROMPT } from '../../src/main/character/prompting/CharacterPrompt'
import { PERSONA_PROMPT_SECTIONS } from '../../src/main/character/prompting/persona.generated'
import { desktopRoot, sourceRoot } from '../architecture/context'
import {
  importedSource,
  parseFile,
  sourceFilesBelow,
  walk,
} from '../support/architecture/sourceAst'

// SHA-256 of SYSTEM_PROMPT before the persona moved into contracts/persona.v1.json.
const PREVIOUS_SYSTEM_PROMPT_SHA256 =
  'b73abe5c3ed42f8cd3bab597b7a4586d829fce27a8af7cd984c83774742e00e3'

describe('persona contract', () => {
  it('generates a SYSTEM_PROMPT byte-identical to the previous inline persona', () => {
    expect(createHash('sha256').update(SYSTEM_PROMPT).digest('hex')).toBe(
      PREVIOUS_SYSTEM_PROMPT_SHA256,
    )
  })

  it('keeps the generated sections equal to the contract', () => {
    const contract = JSON.parse(
      readFileSync(join(desktopRoot, '..', '..', 'contracts', 'persona.v1.json'), 'utf8'),
    ) as { sections: Array<{ id: string; title: string; lines: string[] }> }
    expect(PERSONA_PROMPT_SECTIONS).toEqual(
      Object.fromEntries(contract.sections.map(({ id, title, lines }) => [id, [title, ...lines]])),
    )
  })

  it('keeps the bundled persona out of the renderer', () => {
    for (const file of sourceFilesBelow(join(sourceRoot, 'renderer')))
      walk(parseFile(file), (node) => {
        const specifier = importedSource(node)
        if (specifier) expect(specifier).not.toContain('persona.generated')
      })
  })
})
