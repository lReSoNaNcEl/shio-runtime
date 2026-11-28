import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import postcss, { type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

import { sourceRoot } from '../architecture/context'

function stylesheet(name: string) {
  return postcss.parse(readFileSync(join(sourceRoot, `renderer/styles/${name}.css`), 'utf8'))
}
function declarations(name: string, selector: string, media?: string) {
  const declarations = new Map<string, string>()
  stylesheet(name).walkRules(selector, (rule) => {
    const parent = rule.parent
    const mediaQuery =
      parent?.type === 'atrule' && parent.name === 'media' ? parent.params : undefined
    if (mediaQuery !== media) return
    rule.walkDecls((declaration) => {
      declarations.set(declaration.prop, declaration.value)
    })
  })
  expect(declarations.size, `${name}: ${selector}`).toBeGreaterThan(0)
  return declarations
}

describe('responsive presentation contracts', () => {
  it('allows source cards to grow with accessible labels while preserving thumbnail proportions', () => {
    const card = declarations('chat', '.screen-context-source')
    expect(card.get('flex-direction')).toBe('column')
    const narrowCard = declarations('chat', '.screen-context-source', '(max-width: 540px)')
    expect(narrowCard.get('flex-direction')).toBe('row')
    expect(card.get('height')).toBe('auto')
    expect(card.get('block-size')).toBe('auto')
    expect(declarations('chat', '.screen-context-source-thumbnail').get('aspect-ratio')).toBe(
      '16 / 9',
    )
  })

  it('reflows quick actions relative to their message container', () => {
    const chat = stylesheet('chat')
    const containers: string[] = []
    chat.walkDecls('container-name', (decl) => {
      containers.push(decl.value)
    })
    expect(containers).toContain('chat-message-list')
    let responsive = false
    chat.walkAtRules('container', (rule) => {
      if (!rule.params.startsWith('chat-message-list ')) return
      rule.walkRules((grid) => {
        if (!grid.selectors.some((selector) => selector.endsWith('.chat-quick-action-grid'))) return
        grid.walkDecls('grid-template-columns', (decl) => {
          responsive ||= decl.value === 'minmax(0, 1fr)'
        })
      })
    })
    expect(responsive).toBe(true)
  })

  it('keeps HUD colors semantic with definitions in both themes', () => {
    const hud = declarations('overlay', '.overlay-animation-hud')
    expect(hud.get('background')).toBe('var(--panel)')
    expect(hud.get('color')).toBe('var(--text)')
    for (const value of hud.values()) expect(value).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i)
    const themes = stylesheet('tokens')
    for (const selector of [':root', ':root[data-theme="light"]']) {
      const rule = themes.nodes.find(
        (node): node is Rule => node.type === 'rule' && node.selector === selector,
      )
      expect(rule).toBeDefined()
      const properties: string[] = []
      rule?.walkDecls((decl) => {
        properties.push(decl.prop)
      })
      expect(properties).toEqual(expect.arrayContaining(['--panel', '--text']))
    }
  })
})
