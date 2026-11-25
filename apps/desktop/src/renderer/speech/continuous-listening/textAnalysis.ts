const NORMALIZED_WORD_MIN_LENGTH = 3

export const CORRECTION_PATTERN =
  /(?:^|\s)(?:нет|стоп|подожди|погоди|поправка|я имел[а]? в виду)(?:$|[\s,.!?])/iu

export const DIRECT_ADDRESS_PATTERN = /(?:^|[^\p{L}\p{N}_])(?:shio|шио)(?=$|[^\p{L}\p{N}_])/iu

const normalizeWords = (text: string): Set<string> =>
  new Set(
    text
      .toLocaleLowerCase('ru-RU')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= NORMALIZED_WORD_MIN_LENGTH),
  )

export function textSimilarity(left: string, right: string): number {
  const a = normalizeWords(left)
  const b = normalizeWords(right)
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const word of a) if (b.has(word)) overlap += 1
  const dice = (2 * overlap) / (a.size + b.size)
  const containment = overlap / Math.min(a.size, b.size)
  return Math.max(dice, containment)
}

export function containsPlaybackPhrase(transcript: string, reply: string): boolean {
  const words = (text: string) =>
    text
      .toLocaleLowerCase('ru-RU')
      .replace(/ё/gu, 'е')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  const phrase = words(transcript)
  if (phrase.length < 2) return false
  return ` ${words(reply).join(' ')} `.includes(` ${phrase.join(' ')} `)
}

export function isExplicitBargeInPhrase(text: string): boolean {
  return CORRECTION_PATTERN.test(text) || DIRECT_ADDRESS_PATTERN.test(text)
}
