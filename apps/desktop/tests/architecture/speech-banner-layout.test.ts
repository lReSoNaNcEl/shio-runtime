import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

import { sourceRoot } from './context'

function declarations(rule: Rule): Map<string, string> {
  const values = new Map<string, string>()
  rule.walkDecls((declaration) => {
    values.set(declaration.prop, declaration.value)
  })
  return values
}

describe('speech banner layout', () => {
  it('adapts to the composer container instead of the viewport', () => {
    const stylesheet = readFileSync(join(sourceRoot, 'renderer', 'styles', 'chat.css'), 'utf8')
    const root = postcss.parse(stylesheet)
    const controls = root.nodes.find(
      (node): node is Rule => node.type === 'rule' && node.selector === '#controls',
    )

    expect(controls).toBeDefined()
    const controlDeclarations = declarations(controls as Rule)
    expect(controlDeclarations.get('container-name')).toBe('composer-controls')
    expect(controlDeclarations.get('container-type')).toBe('inline-size')

    const narrowComposer = root.nodes.find(
      (node): node is AtRule =>
        node.type === 'atrule' &&
        node.name === 'container' &&
        node.params === 'composer-controls (max-width: 680px)',
    )
    expect(narrowComposer).toBeDefined()

    const actions = narrowComposer?.nodes?.find(
      (node): node is Rule => node.type === 'rule' && node.selector === '.speech-banner-actions',
    )
    expect(actions).toBeDefined()
    expect(declarations(actions as Rule).get('grid-column')).toBe('1 / -1')
  })
})
