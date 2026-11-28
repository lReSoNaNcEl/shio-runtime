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

describe('persona contract', () => {
  it('generates the system prompt from the canonical persona sections in order', () => {
    const contract = JSON.parse(
      readFileSync(join(desktopRoot, '..', '..', 'contracts', 'persona.v1.json'), 'utf8'),
    ) as { sections: Array<{ id: string; title: string; lines: string[] }> }
    expect(PERSONA_PROMPT_SECTIONS).toEqual(
      Object.fromEntries(contract.sections.map(({ id, title, lines }) => [id, [title, ...lines]])),
    )
    expect(SYSTEM_PROMPT).toBe(
      contract.sections.map(({ title, lines }) => `## ${title}\n${lines.join('\n')}`).join('\n\n'),
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
