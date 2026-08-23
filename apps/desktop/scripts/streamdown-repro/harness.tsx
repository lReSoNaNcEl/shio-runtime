import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { externalHttpUrlSchema } from '../../src/main/system/externalNavigation'
import {
  MarkdownMessage,
  MarkdownRenderErrorBoundary,
  normalizeExternalHttpUrl,
} from '../../src/renderer/components/chat/MarkdownMessage'
import { parseCharacterEmbodimentResponse } from '../../src/shared/character-response'

const desktopRoot = process.cwd().endsWith('apps\\desktop')
  ? process.cwd()
  : join(process.cwd(), 'apps', 'desktop')

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(MarkdownMessage, { text: markdown }))
}

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

assert.match(rich, /Обычный/)
assert.match(rich, /data-streamdown="strong">жирный<\/span>/)
assert.match(rich, /<em>курсивный<\/em>/)
assert.match(rich, /markdown-list-unordered/)
assert.match(rich, /вложенный/)
assert.match(rich, /markdown-table/)
assert.match(rich, /markdown-inline-code/)
assert.match(rich, /markdown-code-block/)
assert.match(rich, /Безопасная цитата/)
assert.match(rich, /https:\/\/example\.com\/docs\?q=shio/)

const malformed = render(`Незакрытый **жирный текст

\`\`\`unknown-language
очень длинная строка ${'x'.repeat(2_000)}
`)
assert.match(malformed, /Незакрытый/)
assert.match(malformed, /x{100}/)

const malicious = render(`
[опасная ссылка](javascript:alert(document.domain))
[data link](data:text/html;base64,PHNjcmlwdD4=)
![data image](data:image/png;base64,iVBORw0KGgo=)
![remote image](https://example.com/tracker.png)
<script>globalThis.pwned = true</script>
<img src=x onerror="alert(1)">
`)
assert.doesNotMatch(malicious, /javascript:|data:text|data:image|tracker\.png|<script|<img/i)
assert.match(malicious, /опасная ссылка/)
assert.match(malicious, /&lt;script&gt;/)

assert.equal(normalizeExternalHttpUrl('javascript:alert(1)'), null)
assert.equal(normalizeExternalHttpUrl('data:text/html,unsafe'), null)
assert.equal(normalizeExternalHttpUrl('file:///C:/private.txt'), null)
assert.equal(normalizeExternalHttpUrl('shio://internal'), null)
assert.equal(normalizeExternalHttpUrl('/relative'), null)
assert.equal(normalizeExternalHttpUrl('https://user:secret@example.com/'), null)
assert.equal(normalizeExternalHttpUrl('https://example.com/path'), 'https://example.com/path')

for (const unsafe of [
  'javascript:alert(1)',
  'data:text/html,unsafe',
  'file:///C:/private.txt',
  'shio://internal',
  '/relative',
  'https://user:secret@example.com/',
]) {
  assert.equal(externalHttpUrlSchema.safeParse(unsafe).success, false)
}
assert.equal(externalHttpUrlSchema.parse('https://example.com/path'), 'https://example.com/path')

const embodiment = parseCharacterEmbodimentResponse(
  '[warm]Текст для пользователя.<shio-embodiment>{"intensity":"subtle"}</shio-embodiment>',
)
assert.equal(embodiment.replyText.includes('shio-embodiment'), false)
assert.equal(render(embodiment.replyText).includes('shio-embodiment'), false)

const boundary = new MarkdownRenderErrorBoundary({ text: '<unsafe>', children: null })
boundary.state = MarkdownRenderErrorBoundary.getDerivedStateFromError()
assert.match(renderToStaticMarkup(boundary.render()), /&lt;unsafe&gt;/)

const componentSource = readFileSync(
  join(desktopRoot, 'src', 'renderer', 'components', 'chat', 'MarkdownMessage.tsx'),
  'utf8',
)
assert.match(componentSource, /mode="static"/)
assert.match(componentSource, /controls=\{false\}/)
assert.match(componentSource, /skipHtml/)
assert.match(componentSource, /allowDataImages:\s*false/)
assert.match(componentSource, /window\.api\.system\.openExternalLink/)
assert.doesNotMatch(componentSource, /streamdown\/styles\.css|tailwind|shadcn|mermaid/i)

const chatSource = readFileSync(
  join(desktopRoot, 'src', 'renderer', 'components', 'chat', 'ChatMessageList.tsx'),
  'utf8',
)
assert(chatSource.indexOf('<MarkdownMessage') < chatSource.indexOf('<ProjectEvidenceBar'))

const packageJson = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
}
assert.equal(packageJson.dependencies.streamdown, '2.5.0')
assert.equal(packageJson.dependencies['rehype-harden'], '1.1.8')

console.log('Streamdown renderer and security focused repro: PASS')
