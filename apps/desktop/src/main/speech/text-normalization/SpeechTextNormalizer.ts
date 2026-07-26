import { stripAssistantMarkup } from '../../../shared/emotion'
import { hasSpeakableContent } from '../../../shared/speech'
import { parseMarkdownForSpeech } from './markdownSpeechParser'
import { applyTechnicalPronunciations } from './technicalPronunciations'
import { normalizeTechnicalNumbers, russianInteger, speakIdentifier } from './technicalTokenParser'
import type {
  SpeechTextNormalizationCategory,
  SpeechTextNormalizationDiagnostics,
  SpeechTextNormalizationInput,
  SpeechTextNormalizationLimits,
  SpeechTextNormalizationResult,
  SpeechUtteranceKind,
} from './types'

export const SPEECH_TEXT_NORMALIZATION_VERSION = 'speech-polish-3.0'

const DEFAULT_EXPANSION_FACTOR = 3
const DEFAULT_EXPANSION_ALLOWANCE = 160
const MAX_URL_CHARACTERS = 180
const MAX_PATH_CHARACTERS = 180
const NONVERBAL_EMOTIONS = new Set([
  'laugh',
  'chuckle',
  'sigh',
  'gasp',
  'groan',
  'crying',
  'whisper',
])

interface PipelineState {
  text: string
  rules: string[]
  categories: SpeechTextNormalizationCategory[]
}

export function normalizeSpeechText(
  input: SpeechTextNormalizationInput,
  limits: SpeechTextNormalizationLimits = {},
): SpeechTextNormalizationResult {
  const original = input.text.normalize('NFC')
  const preliminaryKind = classifySpeechUtterance(original)
  const pipeline = runPipeline(original, input.language, preliminaryKind)
  const fallback = conservativeFallback(original, input.language)
  const maximumLength =
    Math.max(original.length, 1) * (limits.expansionFactor ?? DEFAULT_EXPANSION_FACTOR) +
    (limits.expansionAllowance ?? DEFAULT_EXPANSION_ALLOWANCE)

  let text = pipeline.text
  let fallbackReason: SpeechTextNormalizationDiagnostics['fallbackReason']
  if (hasSpeakableContent(fallback) && !hasSpeakableContent(text)) {
    text = fallback
    fallbackReason = 'empty-output'
  } else if (text.length > maximumLength) {
    text = fallback
    fallbackReason = 'expansion-limit'
  } else if (!isInternallyValid(text)) {
    text = fallback
    fallbackReason = 'invariant'
  } else {
    const idempotenceCheck = runPipeline(text, input.language, classifySpeechUtterance(text)).text
    if (idempotenceCheck !== text) {
      text = fallback
      fallbackReason = 'idempotence'
    }
  }

  const utteranceKind = classifySpeechUtterance(
    text,
    undefined,
    pipeline.categories.some((category) =>
      ['technical-term', 'abbreviation', 'url', 'path', 'version', 'code'].includes(category),
    ),
  )
  return {
    text,
    utteranceKind,
    diagnostics: {
      version: SPEECH_TEXT_NORMALIZATION_VERSION,
      changed: text !== original,
      inputCharacters: original.length,
      outputCharacters: text.length,
      appliedRuleIds: fallbackReason ? [] : pipeline.rules,
      categories: fallbackReason ? [] : pipeline.categories,
      fallbackReason,
    },
  }
}

export function classifySpeechUtterance(
  text: string,
  emotion?: string,
  containsTechnicalToken = false,
): SpeechUtteranceKind {
  const trimmed = text.trim()
  const normalizedEmotion = emotion?.trim().toLowerCase()
  if (normalizedEmotion && NONVERBAL_EMOTIONS.has(normalizedEmotion) && trimmed.length <= 80) {
    return 'nonverbal'
  }
  if (isStandaloneNonverbal(trimmed)) return 'nonverbal'
  if (containsTechnicalToken) return 'technical'
  if (
    trimmed.length <= 24 &&
    !/[A-Z\d]/u.test(trimmed) &&
    /^[\p{L}]+(?:[-\s][\p{L}]+){0,2}[!?…]$/u.test(trimmed) &&
    trimmed.split(/\s+/u).length <= 3
  ) {
    return 'short-interjection'
  }
  return 'normal'
}

function runPipeline(
  text: string,
  language: string,
  utteranceKind: SpeechUtteranceKind,
): PipelineState {
  const rules = new Set<string>()
  const categories = new Set<SpeechTextNormalizationCategory>()
  let output = normalizeWhitespaceStructure(text)
  if (output !== text) rules.add('structure.whitespace')

  if (utteranceKind === 'nonverbal' || utteranceKind === 'short-interjection') {
    categories.add('nonverbal')
    rules.add(`nonverbal.${utteranceKind}`)
    return {
      text: expressiveCleanup(output),
      rules: [...rules],
      categories: [...categories],
    }
  }

  const markdown = parseMarkdownForSpeech(output, language)
  output = markdown.text
  for (const rule of markdown.ruleIds) rules.add(rule)
  if (markdown.ruleIds.length) categories.add('markdown')
  if (markdown.hasCode) categories.add('code')
  if (markdown.hasList) categories.add('list')

  output = replaceUrls(output, language, rules)
  if ([...rules].some((rule) => rule.startsWith('url.'))) categories.add('url')

  output = replacePaths(output, language, rules)
  if ([...rules].some((rule) => rule.startsWith('path.'))) categories.add('path')

  const numbers = normalizeTechnicalNumbers(output, language)
  output = numbers.text
  for (const rule of numbers.ruleIds) rules.add(rule)
  if (numbers.ruleIds.length) categories.add('version')

  const pronunciations = applyTechnicalPronunciations(output, language)
  output = pronunciations.text
  for (const term of pronunciations.rules) {
    rules.add(term.id)
    categories.add(term.category)
  }

  output = finalCleanup(output)
  return { text: output, rules: [...rules], categories: [...categories] }
}

function normalizeWhitespaceStructure(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t\v\f]+/gu, ' ')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function replaceUrls(text: string, language: string, rules: Set<string>): string {
  return text.replace(/https?:\/\/[^\s<>{}[\]]+/giu, (raw) => {
    const trailing = /[.,!?;:]+$/u.exec(raw)?.[0] ?? ''
    const candidate = trailing ? raw.slice(0, -trailing.length) : raw
    rules.add('url.detected')
    return `${speakUrl(candidate, language, rules)}${trailing}`
  })
}

function speakUrl(raw: string, language: string, rules: Set<string>): string {
  if (raw.length > MAX_URL_CHARACTERS) {
    rules.add('url.long')
    return language.toLowerCase().startsWith('ru')
      ? 'длинная ссылка показана в сообщении'
      : 'a long link is shown in the message'
  }
  try {
    const parsed = new URL(raw)
    const ru = language.toLowerCase().startsWith('ru')
    const spoken: string[] = []
    if (parsed.hostname.toLowerCase() === 'localhost') {
      rules.add('url.localhost')
      spoken.push(ru ? 'локалхост' : 'localhost')
    } else if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(parsed.hostname)) {
      rules.add('url.ipv4')
      spoken.push(
        ru
          ? parsed.hostname
              .split('.')
              .map((part) => russianInteger(Number(part)))
              .join(' точка ')
          : parsed.hostname.split('.').join(' dot '),
      )
    } else {
      rules.add('url.hostname')
      spoken.push(
        parsed.hostname
          .split('.')
          .map((part) => speakIdentifier(part, language))
          .join(ru ? ', точка, ' : ', dot, '),
      )
    }
    if (parsed.port) {
      rules.add('url.port')
      spoken.push(
        `${ru ? 'порт' : 'port'} ${ru ? russianInteger(Number(parsed.port)) : parsed.port}`,
      )
    }
    const pathParts = parsed.pathname.split('/').filter(Boolean).slice(0, 8)
    for (const part of pathParts) {
      spoken.push(`${ru ? 'слэш' : 'slash'}, ${speakPathPart(decodeSafely(part), language)}`)
    }
    if (parsed.search) {
      rules.add('url.parameters-redacted')
      spoken.push(ru ? 'ссылка содержит параметры' : 'the link contains parameters')
    }
    if (parsed.hash) rules.add('url.fragment-redacted')
    return spoken.join(', ')
  } catch {
    rules.add('url.malformed')
    return language.toLowerCase().startsWith('ru')
      ? 'ссылка показана в сообщении'
      : 'a link is shown in the message'
  }
}

function replacePaths(text: string, language: string, rules: Set<string>): string {
  const windowsPattern = /(?<![\p{L}\p{N}_])([A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]+)(?![\p{L}\p{N}_])/gu
  let output = text.replace(windowsPattern, (path) => {
    rules.add('path.windows')
    return speakWindowsPath(path, language)
  })
  const posixPattern =
    /(?<![:\p{L}\p{N}_])((?:\.{1,2}\/)?(?:[\p{L}\p{N}_.@-]+\/)+[\p{L}\p{N}_@-]+(?:\.[\p{L}\p{N}_@-]+)*)(?![\p{L}\p{N}_])/gu
  output = output.replace(posixPattern, (path) => {
    if (path.length > MAX_PATH_CHARACTERS) {
      rules.add('path.long')
      return language.toLowerCase().startsWith('ru')
        ? 'длинный путь показан в сообщении'
        : 'a long path is shown in the message'
    }
    rules.add('path.posix')
    return speakPosixPath(path, language)
  })
  return output
}

function speakWindowsPath(path: string, language: string): string {
  const ru = language.toLowerCase().startsWith('ru')
  const drive = path[0].toUpperCase()
  const parts = path.slice(3).split('\\').filter(Boolean)
  const prefix = ru ? `диск ${latinLetterRu(drive)}` : `drive ${drive}`
  return [
    prefix,
    ...parts.flatMap((part) => [ru ? 'обратный слэш' : 'backslash', speakPathPart(part, language)]),
  ].join(', ')
}

function speakPosixPath(path: string, language: string): string {
  const ru = language.toLowerCase().startsWith('ru')
  const relative = path.startsWith('./') || path.startsWith('../')
  const parts = path
    .replace(/^\.{1,2}\//u, '')
    .split('/')
    .filter(Boolean)
  return [
    ...(relative ? [ru ? 'относительный путь' : 'relative path'] : []),
    ...parts.flatMap((part, index) =>
      index === 0
        ? [speakPathPart(part, language)]
        : [ru ? 'слэш' : 'slash', speakPathPart(part, language)],
    ),
  ].join(', ')
}

function speakPathPart(part: string, language: string): string {
  const extension = /^(.+)\.([A-Za-z0-9]{1,8})$/u.exec(part)
  if (!extension) return speakIdentifier(part, language)
  const ru = language.toLowerCase().startsWith('ru')
  return `${speakIdentifier(extension[1], language)}, ${ru ? 'точка' : 'dot'} ${speakIdentifier(extension[2], language)}`
}

function latinLetterRu(letter: string): string {
  const names: Readonly<Record<string, string>> = {
    A: 'эй',
    B: 'би',
    C: 'си',
    D: 'ди',
    E: 'и',
    F: 'эф',
  }
  return names[letter] ?? letter.toLowerCase()
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function finalCleanup(text: string): string {
  return text
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n+ */gu, '. ')
    .replace(/\s+([,.;!?…])/gu, '$1')
    .replace(/([,;:])(?=\S)/gu, '$1 ')
    .replace(/\.{2}(?!\.)/gu, '.')
    .replace(/\s{2,}/gu, ' ')
    .replace(/(?:\.\s*){2,}/gu, '. ')
    .trim()
}

function expressiveCleanup(text: string): string {
  return text
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n+ */gu, ' ')
    .trim()
}

function conservativeFallback(text: string, language: string): string {
  const ru = language.toLowerCase().startsWith('ru')
  const contentSafe = text
    .replace(
      /```[^\r\n]*\r?\n[\s\S]*?```/gu,
      ru ? ' Код показан в сообщении. ' : ' Code is shown in the message. ',
    )
    .replace(
      /https?:\/\/[^\s<>{}[\]]+/giu,
      ru ? 'ссылка показана в сообщении' : 'a link is shown in the message',
    )
  const stripped = stripAssistantMarkup(contentSafe)
  return normalizeWhitespaceStructure(stripped || contentSafe || text)
}

function isStandaloneNonverbal(text: string): boolean {
  if (!text || text.length > 32) return false
  return /^(?:[хx](?:а|о|е)(?:[-–—][хx](?:а|о|е))+|хм+|м-м+|м+|ох+|ах+|ух+|фу+х*|эх+|ага|угу|ха+|heh|hm+|oh+|ah+|huh+)[.!?…]*$/iu.test(
    text,
  )
}

function isInternallyValid(text: string): boolean {
  return (
    typeof text === 'string' &&
    !text.includes('\u0000') &&
    !/[\uE000-\uF8FF]/u.test(text) &&
    !/\s{4,}/u.test(text)
  )
}
