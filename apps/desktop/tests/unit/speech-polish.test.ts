import { describe, it } from 'vitest'

import {
  normalizeSpeechText,
  SPEECH_TEXT_NORMALIZATION_VERSION,
} from '../../src/main/speech/text-normalization'
import { parseEmotionalReply, stripAssistantMarkup } from '../../src/shared/emotion'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Speech Polish repro failed: ${message}`)
}

function normalize(text: string, language = 'ru'): string {
  return normalizeSpeechText({ text, language }).text
}

function includes(text: string, expected: string, message: string): void {
  check(text.toLowerCase().includes(expected.toLowerCase()), `${message}: ${text}`)
}

function excludes(text: string, unexpected: string, message: string): void {
  check(!text.toLowerCase().includes(unexpected.toLowerCase()), `${message}: ${text}`)
}

function runRepresentationRegression(): void {
  const replyText = '[happy]## GPT-5.6\n\nПервая часть. [calm]Use `src/main`.'
  const parsed = parseEmotionalReply(replyText)
  const displayText = parsed.visibleText
  const originalBoundaries = parsed.segments.map((segment) => ({
    index: segment.index,
    boundaryAfter: segment.boundaryAfter,
    targetMaxGapMs: segment.targetMaxGapMs,
  }))
  const normalized = parsed.segments.map((segment) =>
    normalizeSpeechText({ text: stripAssistantMarkup(segment.text), language: 'ru' }),
  )

  check(replyText.startsWith('[happy]'), 'replyText remains original')
  check(parsed.visibleText === displayText, 'visible display text is unchanged')
  check(normalized.length === parsed.segments.length, 'emotion segment count is unchanged')
  check(
    JSON.stringify(originalBoundaries) ===
      JSON.stringify(
        parsed.segments.map((segment) => ({
          index: segment.index,
          boundaryAfter: segment.boundaryAfter,
          targetMaxGapMs: segment.targetMaxGapMs,
        })),
      ),
    'emotion boundaries and gap targets are unchanged',
  )
}

function runPronunciationRegression(): void {
  check(normalize('GPT-5.6') === 'джи-пи-ти пять точка шесть', 'GPT-5.6 pronunciation')
  check(normalize('VRMA и VRM') === 'ви-ар-эм-эй и ви-ар-эм', 'VRMA is matched before VRM')
  includes(normalize('TypeScript GitHub WebSocket localhost'), 'тайпскрипт', 'TypeScript')
  includes(normalize('TypeScript GitHub WebSocket localhost'), 'гитхаб', 'GitHub')
  includes(normalize('TypeScript GitHub WebSocket localhost'), 'веб-сокет', 'WebSocket')
  includes(normalize('TypeScript GitHub WebSocket localhost'), 'локалхост', 'localhost')
  check(normalize('src/main') === 'эс-эр-си, слэш, мэйн', 'src/main path')
  includes(
    normalize('apps/api/app/routes/synthesize.py'),
    'эппс, слэш, эй-пи-ай',
    'POSIX repository path',
  )
  includes(normalize('C:\\Users\\Name\\project'), 'диск си', 'Windows drive')
  includes(normalize('C:\\Users\\Name\\project'), 'обратный слэш', 'Windows separator')
  check(
    normalize('v0.1.0-alpha.6') === 'версия ноль точка один точка ноль, альфа шесть',
    'semantic version',
  )
  check(
    normalize('127.0.0.1') === 'сто двадцать семь точка ноль точка ноль точка один',
    'IPv4 address',
  )
  includes(normalize('Node.js 24'), 'ноуд джи-эс двадцать четыре', 'technical integer')
  includes(normalize('CUDA 12.8'), 'куда двенадцать точка восемь', 'technical decimal')
}

function runMarkdownAndUrlRegression(): void {
  check(normalize('## Important') === 'Important', 'Markdown heading')
  const bullets = normalize('- первый\n- второй')
  excludes(bullets, 'минус', 'bullet marker is not spoken')
  includes(bullets, 'первый.', 'first bullet boundary')
  includes(normalize('1. один\n2. два'), 'Пункт один', 'numbered list')
  check(normalize('[GitHub](https://github.com)') === 'гитхаб', 'Markdown link label')
  const url = normalize('http://localhost:8000/health')
  includes(url, 'локалхост, порт восемь тысяч, слэш, хэлс', 'localhost URL')
  const secretUrl = normalize('https://example.com/docs/api?token=secret#authorization')
  excludes(secretUrl, 'secret', 'URL query values are not spoken')
  excludes(secretUrl, 'authorization', 'URL fragments are not spoken')
  includes(secretUrl, 'ссылка содержит параметры', 'query presence is content-free')
  check(normalize('Use `src/main`.') === 'Use эс-эр-си, слэш, мэйн.', 'inline code')
  const code = normalize('До.\n```ts\nconst secret = 1\nconsole.log(secret)\n```\nПосле.')
  includes(code, 'Код показан в сообщении.', 'multiline code omission')
  excludes(code, 'console', 'multiline code contents are omitted')
}

function runSafetyAndIdempotenceRegression(): void {
  check(normalize('Ха-ха!') === 'Ха-ха!', 'nonverbal reaction remains natural')
  check(normalize('Фух…') === 'Фух…', 'breath-like reaction remains natural')
  check(normalize('foo_bar_baz') === 'foo_bar_baz', 'underscore identifier remains intact')
  check(
    normalize('some_file_name.py') === 'some_file_name.py',
    'underscore filename remains intact',
  )
  check(
    normalize('`some_file_name.py`') === 'some_file_name.py',
    'inline code with underscores remains intact',
  )
  check(normalize('__init__.py') === '__init__.py', 'dunder filename remains intact')
  check(normalize('__dunder__') === '__dunder__', 'dunder identifier remains intact')
  check(normalize('_my emphasis_') === 'my emphasis', 'underscore emphasis is cleaned')
  check(normalize('**bold**') === 'bold', 'bold emphasis is cleaned')
  check(
    normalize('CustomWidgetFactory') === 'CustomWidgetFactory',
    'unknown identifier is conservative',
  )
  check(
    normalize('MyVRMAFactory') === 'MyVRMAFactory',
    'technical term is not replaced inside longer identifier',
  )

  const corpus = [
    'GPT-5.6 работает с TypeScript.',
    'Открой http://localhost:8000/health.',
    'Проверь apps/api/app/routes/synthesize.py.',
    '- GitHub\n- JSON',
    'Хм…',
  ]
  for (const item of corpus) {
    const once = normalize(item)
    const twice = normalize(once)
    check(once === twice, `normalizer is idempotent for ${item}`)
  }

  const expansion = normalizeSpeechText(
    { text: 'GPT-5.6', language: 'ru' },
    { expansionFactor: 0, expansionAllowance: 0 },
  )
  check(expansion.text === 'GPT-5.6', 'expansion guard falls back safely')
  check(expansion.diagnostics.fallbackReason === 'expansion-limit', 'expansion fallback reason')

  const empty = normalizeSpeechText({
    text: '![](https://example.com/private?token=secret)',
    language: 'ru',
  })
  check(empty.text.length > 0, 'empty normalization result falls back safely')
  check(empty.diagnostics.fallbackReason === 'empty-output', 'empty fallback reason')
  excludes(empty.text, 'secret', 'empty fallback does not expose URL query values')

  const russian = normalize('TypeScript and GitHub', 'ru')
  const english = normalize('TypeScript and GitHub', 'en')
  includes(russian, 'тайпскрипт', 'Russian mode transliterates known terms')
  check(english === 'TypeScript and GitHub', 'English mode preserves English technical terms')
}

function main(): void {
  runRepresentationRegression()
  runPronunciationRegression()
  runMarkdownAndUrlRegression()
  runSafetyAndIdempotenceRegression()
  console.log(`PASS: Speech Polish ${SPEECH_TEXT_NORMALIZATION_VERSION} focused Desktop repro`)
}

describe('speech text normalization', () => {
  it('normalizes representation, pronunciation, markup, and unsafe input', () => {
    main()
  })
})
