import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

import { memberName, parseFile, walk } from '../support/architecture/sourceAst'
import { sourceRoot } from './context'

describe('Alive UI architecture', () => {
  it('uses owned Tasks selectors and valid semantic design tokens', () => {
    const stylesheet = readFileSync(join(sourceRoot, 'renderer', 'styles', 'tasks.css'), 'utf8')
    const root = postcss.parse(stylesheet)
    const selectors = new Set<string>()
    root.walkRules((rule) => {
      for (const selector of rule.selectors) selectors.add(selector)
    })
    root.walkDecls((declaration) => {
      expect(declaration.value).not.toContain('--s2-space-')
      expect(declaration.value).not.toContain('--s2-corner-radius-')
    })
    expect(selectors).toContain('.tasks-form-surface')
    expect(selectors).toContain('.tasks-create-actions')
    expect(selectors).toContain('.tasks-conversation-first')
  })

  it('uses Spectrum Disclosure and measurable goal state structurally', () => {
    const view = join(sourceRoot, 'renderer', 'components', 'views', 'TasksView.tsx')
    let disclosureElements = 0
    let measurableReads = 0
    walk(parseFile(view), (node) => {
      if (node.type === 'JSXOpeningElement' && memberName(node.name as never) === 'Disclosure') {
        disclosureElements += 1
      }
      if (
        node.type === 'MemberExpression' &&
        memberName(node.property) === 'measurable' &&
        memberName(node.object as never) === 'goal'
      ) {
        measurableReads += 1
      }
    })
    expect(disclosureElements).toBeGreaterThan(0)
    expect(measurableReads).toBeGreaterThan(0)
  })
})
