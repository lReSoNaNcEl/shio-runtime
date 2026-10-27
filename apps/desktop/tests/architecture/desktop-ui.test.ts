import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

import {
  type AstNode,
  importedSource,
  memberName,
  memberPath,
  parseFile,
  sourceFilesBelow,
  walk,
} from '../support/architecture/sourceAst'
import { sourceRoot } from './context'

const components = join(sourceRoot, 'renderer/components')

describe('Desktop UI ownership', () => {
  it('uses Spectrum for available UI primitives', () => {
    const nativePrimitives = new Set([
      'button',
      'input',
      'select',
      'textarea',
      'details',
      'summary',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
    ])
    for (const file of sourceFilesBelow(components)) {
      walk(parseFile(file), (node) => {
        if (node.type === 'JSXOpeningElement') {
          expect(
            nativePrimitives.has(memberName(node.name as unknown as AstNode) ?? ''),
            relative(components, file),
          ).toBe(false)
        }
      })
    }
  })

  it('keeps feature styles owned and imported outside the global baseline', () => {
    const baseline = postcss.parse(
      readFileSync(join(sourceRoot, 'renderer/styles/base.css'), 'utf8'),
    )
    baseline.walkRules((rule) => {
      expect(rule.selector).not.toMatch(
        /\.(?:app-shell|chat-|settings-|avatar-preview|health-|diagnostics-)/,
      )
    })
    const imports: string[] = []
    walk(parseFile(join(sourceRoot, 'renderer/main.tsx')), (node) => {
      const specifier = importedSource(node)
      if (specifier) imports.push(specifier)
    })
    for (const feature of [
      'shell',
      'chat',
      'capabilities',
      'settings',
      'avatar-preview',
      'plugins',
      'diagnostics',
    ]) {
      expect(imports).toContain(`./styles/${feature}.css`)
      expect(
        postcss.parse(readFileSync(join(sourceRoot, `renderer/styles/${feature}.css`), 'utf8'))
          .nodes.length,
      ).toBeGreaterThan(0)
    }
  })

  it('keeps Project configuration in Plugins and Desktop credentials out of the renderer API', () => {
    for (const file of sourceFilesBelow(join(components, 'settings'))) {
      walk(parseFile(file), (node) => {
        const specifier = importedSource(node)
        if (specifier)
          expect(specifier, file).not.toMatch(/ProjectSettings|ProjectAwarenessPluginView/)
      })
    }
    for (const file of sourceFilesBelow(join(components, 'plugins'))) {
      walk(parseFile(file), (node) => {
        if (node.type === 'CallExpression') {
          expect(memberPath(node.callee) ?? '', file).not.toMatch(
            /window\.api\.desktopControl\.(?:save|forget)Credential/,
          )
        }
      })
    }
  })
})
