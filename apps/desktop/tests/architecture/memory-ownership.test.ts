import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { importedSource, memberName, parseFile, walk } from '../support/architecture/sourceAst'
import { desktopRoot, sourceRoot } from './context'

describe('Memory ownership boundaries', () => {
  it.each(['main/alive/AliveStore.ts', 'main/alive/ExperienceRuntime.ts'])(
    'keeps %s independent from Memory implementations',
    (relativePath) => {
      const file = join(sourceRoot, ...relativePath.split('/'))
      walk(parseFile(file), (node) => {
        const specifier = importedSource(node)
        if (specifier) {
          expect(
            !specifier.includes('/memory') && !specifier.includes('MemoryStore'),
            `${relative(desktopRoot, file)} imports Memory implementation ${specifier}`,
          ).toBe(true)
        }
        if (node.type === 'Identifier') {
          expect(node.name, `${relativePath} owns a Memory habit store`).not.toBe('memory_habits')
          expect(node.name, `${relativePath} observes procedural habits directly`).not.toBe(
            'observeHabit',
          )
        }
        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
          expect(
            memberName(node.callee.property),
            `${relativePath} writes Memory records`,
          ).not.toBe('insertMany')
        }
      })
    },
  )
})
