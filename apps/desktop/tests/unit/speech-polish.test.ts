import { describe, expect, it } from 'vitest'

import { normalizeSpeechText } from '../../src/main/speech/text-normalization'

function normalize(text: string, language = 'ru'): string {
  return normalizeSpeechText({ text, language }).text
}

describe('speech text normalization', () => {
  it('pronounces technical terms, paths, versions, and addresses', () => {
    expect(normalize('GPT-5.6')).toBe('джи-пи-ти пять точка шесть')
    expect(normalize('VRMA и VRM')).toBe('ви-ар-эм-эй и ви-ар-эм')
    const terms = normalize('TypeScript GitHub WebSocket localhost').toLowerCase()
    for (const term of ['тайпскрипт', 'гитхаб', 'веб-сокет', 'локалхост']) {
      expect(terms).toContain(term)
    }

    expect(normalize('src/main')).toBe('эс-эр-си, слэш, мэйн')
    expect(normalize('apps/api/app/routes/tts.py')).toContain('эппс, слэш, эй-пи-ай')
    const windowsPath = normalize('C:\\Users\\Name\\project').toLowerCase()
    expect(windowsPath).toContain('диск си')
    expect(windowsPath).toContain('обратный слэш')
    expect(normalize('v0.1.0-alpha.6')).toBe('версия ноль точка один точка ноль, альфа шесть')
    expect(normalize('127.0.0.1')).toBe('сто двадцать семь точка ноль точка ноль точка один')
    expect(normalize('Node.js 24')).toMatch(/ноуд джи-эс двадцать четыре/iu)
    expect(normalize('CUDA 12.8')).toMatch(/куда двенадцать точка восемь/iu)
  })

  it('reads markup and URLs without revealing URL parameters or fenced code', () => {
    expect(normalize('## Important')).toBe('Important')
    const bullets = normalize('- первый\n- второй')
    expect(bullets).not.toMatch(/минус/iu)
    expect(bullets).toMatch(/первый\./iu)
    expect(normalize('1. один\n2. два')).toMatch(/пункт один/iu)
    expect(normalize('[GitHub](https://github.com)')).toBe('гитхаб')
    expect(normalize('http://localhost:8000/health')).toMatch(
      /локалхост, порт восемь тысяч, слэш, хэлс/iu,
    )
    const secretUrl = normalize('https://example.com/docs/api?token=secret#authorization')
    expect(secretUrl).not.toMatch(/secret|authorization/iu)
    expect(secretUrl).toMatch(/ссылка содержит параметры/iu)
    expect(normalize('Use `src/main`.')).toBe('Use эс-эр-си, слэш, мэйн.')
    const code = normalize('До.\n```ts\nconst secret = 1\nconsole.log(secret)\n```\nПосле.')
    expect(code).toMatch(/код показан в сообщении\./iu)
    expect(code).not.toMatch(/console/iu)
  })

  it('preserves reactions and identifiers while stripping emphasis', () => {
    for (const text of [
      'Ха-ха!',
      'Фух…',
      'foo_bar_baz',
      'some_file_name.py',
      '__init__.py',
      '__dunder__',
      'CustomWidgetFactory',
      'MyVRMAFactory',
    ]) {
      expect(normalize(text)).toBe(text)
    }
    expect(normalize('`some_file_name.py`')).toBe('some_file_name.py')
    expect(normalize('_my emphasis_')).toBe('my emphasis')
    expect(normalize('**bold**')).toBe('bold')
  })

  it('keeps repeated normalization stable', () => {
    for (const text of [
      'GPT-5.6 работает с TypeScript.',
      'Открой http://localhost:8000/health.',
      'Проверь apps/api/app/routes/tts.py.',
      '- GitHub\n- JSON',
      'Хм…',
    ]) {
      const normalized = normalize(text)
      expect(normalize(normalized), text).toBe(normalized)
    }
  })

  it('handles excessive expansion and empty output without exposing URL parameters', () => {
    const expansion = normalizeSpeechText(
      { text: 'GPT-5.6', language: 'ru' },
      { expansionFactor: 0, expansionAllowance: 0 },
    )
    expect(expansion.text).toBe('GPT-5.6')
    expect(expansion.diagnostics.fallbackReason).toBe('expansion-limit')

    const empty = normalizeSpeechText({
      text: '![](https://example.com/private?token=secret)',
      language: 'ru',
    })
    expect(empty.text.length).toBeGreaterThan(0)
    expect(empty.diagnostics.fallbackReason).toBe('empty-output')
    expect(empty.text).not.toMatch(/secret/iu)
  })

  it('transliterates known terms only in Russian mode', () => {
    const text = 'TypeScript and GitHub'
    expect(normalize(text, 'ru')).toMatch(/тайпскрипт/iu)
    expect(normalize(text, 'en')).toBe(text)
  })
})
