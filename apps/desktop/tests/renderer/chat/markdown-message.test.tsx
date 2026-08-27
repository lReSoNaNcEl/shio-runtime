import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { externalHttpUrlSchema } from '../../../src/main/system/externalNavigation'
import {
  MarkdownMessage,
  MarkdownRenderErrorBoundary,
  normalizeExternalHttpUrl,
} from '../../../src/renderer/components/chat/MarkdownMessage'
import { parseCharacterEmbodimentResponse } from '../../../src/shared/character-response'

const desktopRoot = fileURLToPath(new URL('../../..', import.meta.url))

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(MarkdownMessage, { text: markdown }))
}

describe('Markdown message rendering', () => {
  it('renders supported rich-text structures', () => {
    const rich = render(`Обычный **жирный** и *курсивный* текст.

- первый
  - вложенный
- второй

| Имя | Статус |
| --- | --- |
| Shio | готова |

Код: \`const ready = true\`.

\`\`\`typescript
const answer: string = 'работает'
\`\`\`

> Безопасная цитата

[Документация](https://example.com/docs?q=shio)
`)

    expect(rich).toContain('Обычный')
    expect(rich).toMatch(/data-streamdown="strong">жирный<\/span>/)
    expect(rich).toContain('<em>курсивный</em>')
    expect(rich).toContain('markdown-list-unordered')
    expect(rich).toContain('вложенный')
    expect(rich).toContain('markdown-table')
    expect(rich).toContain('markdown-inline-code')
    expect(rich).toContain('markdown-code-block')
    expect(rich).toContain('Безопасная цитата')
    expect(rich).toContain('https://example.com/docs?q=shio')
  })

  it('contains malformed and hostile Markdown as visible safe text', () => {
    const malformed = render(`Незакрытый **жирный текст

\`\`\`unknown-language
очень длинная строка ${'x'.repeat(2_000)}
`)
    expect(malformed).toContain('Незакрытый')
    expect(malformed).toMatch(/x{100}/)

    const malicious = render(`
[опасная ссылка](javascript:alert(document.domain))
[data link](data:text/html;base64,PHNjcmlwdD4=)
![data image](data:image/png;base64,iVBORw0KGgo=)
![remote image](https://example.com/tracker.png)
<script>globalThis.pwned = true</script>
<img src=x onerror="alert(1)">
`)
    expect(malicious).not.toMatch(/javascript:|data:text|data:image|tracker\.png|<script|<img/i)
    expect(malicious).toContain('опасная ссылка')
    expect(malicious).toContain('&lt;script&gt;')
  })

  it('allows only anonymous external HTTP URLs in renderer and Main validation', () => {
    const unsafe = [
      'javascript:alert(1)',
      'data:text/html,unsafe',
      'file:///C:/private.txt',
      'shio://internal',
      '/relative',
      'https://user:secret@example.com/',
    ]
    for (const value of unsafe) {
      expect(normalizeExternalHttpUrl(value)).toBeNull()
      expect(externalHttpUrlSchema.safeParse(value).success).toBe(false)
    }
    expect(normalizeExternalHttpUrl('https://example.com/path')).toBe('https://example.com/path')
    expect(externalHttpUrlSchema.parse('https://example.com/path')).toBe('https://example.com/path')
  })

  it('removes embodiment protocol data before Markdown presentation', () => {
    const embodiment = parseCharacterEmbodimentResponse(
      '[warm]Текст для пользователя.<shio-embodiment>{"intensity":"subtle"}</shio-embodiment>',
    )
    expect(embodiment.replyText).not.toContain('shio-embodiment')
    expect(render(embodiment.replyText)).not.toContain('shio-embodiment')
  })

  it('falls back to escaped plaintext after a render failure', () => {
    const boundary = new MarkdownRenderErrorBoundary({ text: '<unsafe>', children: null })
    boundary.state = MarkdownRenderErrorBoundary.getDerivedStateFromError()
    expect(renderToStaticMarkup(boundary.render())).toContain('&lt;unsafe&gt;')
  })

  it('keeps the audited Markdown dependencies pinned', () => {
    const packageJson = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(packageJson.dependencies.streamdown).toBe('2.5.0')
    expect(packageJson.dependencies['rehype-harden']).toBe('1.1.8')
  })
})
