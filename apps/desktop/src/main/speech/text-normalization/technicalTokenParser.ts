import { pronounceKnownSegment } from './technicalPronunciations'

const ONES = [
  'ноль',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
] as const
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
] as const
const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
] as const
const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
] as const

export interface TechnicalNumberNormalization {
  text: string
  ruleIds: string[]
}

export function normalizeTechnicalNumbers(
  text: string,
  language: string,
): TechnicalNumberNormalization {
  if (!language.toLowerCase().startsWith('ru')) return { text, ruleIds: [] }

  const ruleIds = new Set<string>()
  let output = text

  output = output.replace(
    /(?<![\p{L}\p{N}_])v(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?(?![\p{L}\p{N}_])/giu,
    (_match, major: string, minor: string, patch: string, label?: string, iteration?: string) => {
      ruleIds.add('version.semantic')
      const suffix =
        label && iteration
          ? `, ${label.toLowerCase() === 'alpha' ? 'альфа' : speakIdentifier(label, language)} ${russianInteger(Number(iteration))}`
          : ''
      return `версия ${russianInteger(Number(major))} точка ${russianInteger(Number(minor))} точка ${russianInteger(Number(patch))}${suffix}`
    },
  )

  output = output.replace(
    /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/gu,
    (_match, ...parts: string[]) => {
      const octets = parts.slice(0, 4).map(Number)
      if (octets.some((part) => part > 255)) return _match
      ruleIds.add('version.ipv4')
      return octets.map(russianInteger).join(' точка ')
    },
  )

  output = output.replace(
    /(?<![\p{L}\p{N}_-])(\d+)\.(\d+)(?![\p{L}\p{N}_.])/gu,
    (_match, whole: string, fraction: string) => {
      ruleIds.add('version.decimal')
      return `${russianInteger(Number(whole))} точка ${russianInteger(Number(fraction))}`
    },
  )

  output = output.replace(
    /(?<![\p{L}\p{N}_])(Node\.js|Python|CUDA)\s+(\d+)(?![\p{L}\p{N}_.])/giu,
    (_match, term: string, value: string) => {
      ruleIds.add('version.technical-number')
      return `${term} ${russianInteger(Number(value))}`
    },
  )

  return { text: output, ruleIds: [...ruleIds] }
}

export function russianInteger(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return String(value)
  if (value < 10) return ONES[value]
  if (value < 20) return TEENS[value - 10]
  if (value < 100) {
    const ones = value % 10
    return [TENS[Math.floor(value / 10)], ones ? ONES[ones] : ''].filter(Boolean).join(' ')
  }
  if (value < 1000) {
    const rest = value % 100
    return [HUNDREDS[Math.floor(value / 100)], rest ? russianInteger(rest) : '']
      .filter(Boolean)
      .join(' ')
  }
  if (value < 10_000) {
    const thousands = Math.floor(value / 1000)
    const form =
      thousands === 1
        ? 'одна тысяча'
        : thousands === 2
          ? 'две тысячи'
          : `${russianInteger(thousands)} ${thousands < 5 ? 'тысячи' : 'тысяч'}`
    const rest = value % 1000
    return [form, rest ? russianInteger(rest) : ''].filter(Boolean).join(' ')
  }
  return String(value)
    .split('')
    .map((digit) => ONES[Number(digit)])
    .join(' ')
}

export function speakIdentifier(identifier: string, language: string): string {
  const known = pronounceKnownSegment(identifier, language)
  if (known) return known

  const parts = identifier
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[-_]+/u)
    .filter(Boolean)
  if (!parts.length) return identifier
  return parts.join(' ').toLowerCase()
}
