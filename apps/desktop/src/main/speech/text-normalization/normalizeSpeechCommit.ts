import type { SpeechStreamStart } from '../../../shared/speech'
import { normalizeSpeechText } from './SpeechTextNormalizer'
import { isTechnicalTerm } from './technicalPronunciations'

type SpeechLanguage = SpeechStreamStart['language']

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' })

function proseLanguage(text: string, fallback: SpeechLanguage): SpeechLanguage {
  const prose = text.replace(
    /```[\s\S]*?(?:```|$)|`[^`\n]*`|\]\([^)\n]*\)|(?:https?:\/\/|www\.)\S+/giu,
    ' ',
  )
  // Keep paths, versions and identifiers intact so their components do not count as prose.
  const tokens = prose.match(/[\p{L}\p{N}_]+(?:[./\\:@-]+[\p{L}\p{N}_]+)*/gu) ?? []
  let russian = 0
  let english = 0
  for (const token of tokens) {
    if (/^[а-яё]+(?:-[а-яё]+)*$/iu.test(token)) russian++
    else if (
      /^[a-z]+(?:-[a-z]+)*$/iu.test(token) &&
      !isTechnicalTerm(token) &&
      !/^[A-Z]{2,4}$|[a-z][A-Z]/u.test(token)
    )
      english++
  }
  if (russian === english) return fallback
  return russian > english ? 'ru' : 'en'
}

export function normalizeSpeechCommit(text: string, fallback: SpeechLanguage) {
  // Keep Markdown constructs whole for the existing parser and its code/link filtering.
  const mixedProse = /[а-яё]/iu.test(text) && /[a-z]/iu.test(text) && !/`|\]\(/u.test(text)
  const parts = mixedProse ? Array.from(sentences.segment(text), ({ segment }) => segment) : [text]
  let language = fallback
  let pending = ''
  const normalized: string[] = []
  for (const part of parts) {
    const next = proseLanguage(part, language)
    if (pending && next !== language) {
      normalized.push(normalizeSpeechText({ text: pending, language }).text)
      pending = ''
    }
    language = next
    pending += part
  }
  normalized.push(normalizeSpeechText({ text: pending, language }).text)
  return { text: normalized.filter(Boolean).join(' '), language }
}
