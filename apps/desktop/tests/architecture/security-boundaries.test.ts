import { relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseFile, walk } from '../support/architecture/sourceAst'
import { desktopRoot, sourceFiles } from './context'

describe('Desktop structural security boundaries', () => {
  it('does not reintroduce application-owned semantic routers', () => {
    const forbiddenNames = new Set([
      'ProjectRelevanceGate.ts',
      'ProjectContextRequirementResolver.ts',
    ])
    for (const file of sourceFiles) {
      expect(
        forbiddenNames.has(file.split(/[\\/]/u).at(-1) ?? ''),
        `${relative(desktopRoot, file)} reintroduces application-owned semantic routing`,
      ).toBe(false)
    }
  })

  it('does not expose generic Plugin dispatch', () => {
    for (const file of sourceFiles) {
      walk(parseFile(file), (node) => {
        if (!['StringLiteral', 'Literal'].includes(node.type ?? '')) return
        expect(
          node.value,
          `${relative(desktopRoot, file)} introduces forbidden generic Plugin dispatch`,
        ).not.toBe('plugin.invoke')
      })
    }
  })
})
