import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  importedSource,
  isBelow,
  parseFile,
  resolvedImport,
  walk,
} from '../support/architecture/sourceAst'
import { desktopRoot, sourceFiles, sourceRoot } from './context'

describe('Desktop process boundaries', () => {
  it('keeps shared code independent from process implementations', () => {
    const sharedRoot = join(sourceRoot, 'shared')
    const rendererRoot = join(sourceRoot, 'renderer')
    const mainRoot = join(sourceRoot, 'main')

    for (const file of sourceFiles.filter((path) => isBelow(path, sharedRoot))) {
      walk(parseFile(file), (node) => {
        const specifier = importedSource(node)
        if (!specifier) return
        const target = resolvedImport(file, specifier)
        if (!target) return
        expect(
          !isBelow(target, mainRoot) && !isBelow(target, rendererRoot),
          `${relative(desktopRoot, file)} crosses into a process implementation: ${specifier}`,
        ).toBe(true)
      })
    }
  })

  it('keeps the renderer independent from Electron Main implementations', () => {
    const rendererRoot = join(sourceRoot, 'renderer')
    const mainRoot = join(sourceRoot, 'main')

    for (const file of sourceFiles.filter((path) => isBelow(path, rendererRoot))) {
      walk(parseFile(file), (node) => {
        const specifier = importedSource(node)
        if (!specifier) return
        const target = resolvedImport(file, specifier)
        if (!target) return
        expect(
          !isBelow(target, mainRoot),
          `${relative(desktopRoot, file)} imports Electron Main implementation: ${specifier}`,
        ).toBe(true)
      })
    }
  })
})
