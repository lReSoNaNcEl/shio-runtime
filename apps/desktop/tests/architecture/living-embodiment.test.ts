import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  importedSource,
  parseFile,
  sourceFilesBelow,
  walk,
} from '../support/architecture/sourceAst'
import { desktopRoot, sourceRoot } from './context'

describe('living embodiment ownership', () => {
  it('keeps Alive and Behavior free of renderer Avatar internals', () => {
    for (const file of sourceFilesBelow(join(sourceRoot, 'main', 'alive'))) {
      walk(parseFile(file), (node) => {
        const specifier = importedSource(node)
        if (!specifier) return
        expect(
          !specifier.includes('renderer/'),
          `${relative(desktopRoot, file)} imports renderer internals: ${specifier}`,
        ).toBe(true)
      })
    }
  })

  it('reads artistic arm limits only from the expressiveness profile', () => {
    for (const path of [
      ['renderer', 'avatar', 'rendering', 'three', 'StandingMotionStyle.ts'],
      ['renderer', 'avatar', 'rendering', 'three', 'GeneratedBodyPlayback.ts'],
    ]) {
      const source = readFileSync(join(sourceRoot, ...path), 'utf8')
      expect(source).toContain('expressivenessProfile')
      expect(source).not.toMatch(/shoulder:\s*0\.\d+,\s*upper:/u)
      expect(source).not.toMatch(/speaking \? 0\.6 : 0\.15/u)
    }
  })
})
