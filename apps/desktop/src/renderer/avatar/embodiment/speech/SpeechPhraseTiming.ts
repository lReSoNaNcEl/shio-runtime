export interface PhraseBoundary {
  type: 'comma' | 'sentence' | 'ellipsis' | 'dash'
  normalizedPosition: number
}

export interface SpeechPhraseTimingPlan {
  boundaries: PhraseBoundary[]
  hasTerminalPunctuation: boolean
}

const ELLIPSIS_PATTERN = /(?:\.\.\.|\u2026)/gu
const SENTENCE_PATTERN = /[.!?\u3002\uff01\uff1f]/gu
const COMMA_PATTERN = /[,;:\uff0c\uff1b\uff1a]/gu
const DASH_PATTERN = /(?:\u2014|\u2013|(?<=\s)-(?=\s))/gu
const TERMINAL_PATTERN =
  /(?:[.!?\u3002\uff01\uff1f]|(?:\.\.\.|\u2026))[\s"'\u00bb\u201d\u2019)\]]*$/u

export function buildSpeechPhraseTimingPlan(text: string): SpeechPhraseTimingPlan {
  if (!text) return { boundaries: [], hasTerminalPunctuation: false }

  const boundaries: PhraseBoundary[] = []
  const occupied = new Set<number>()
  const addMatches = (
    pattern: RegExp,
    type: PhraseBoundary['type'],
    positionAtEnd = false,
  ): void => {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const index = (match.index ?? 0) + (positionAtEnd ? match[0].length - 1 : 0)
      if (occupied.has(index)) continue
      if (type === 'ellipsis') {
        for (let offset = 0; offset < match[0].length; offset += 1)
          occupied.add((match.index ?? 0) + offset)
      } else {
        occupied.add(index)
      }
      boundaries.push({
        type,
        normalizedPosition: clampPosition((index + 1) / text.length),
      })
    }
  }

  addMatches(ELLIPSIS_PATTERN, 'ellipsis', true)
  addMatches(SENTENCE_PATTERN, 'sentence')
  addMatches(COMMA_PATTERN, 'comma')
  addMatches(DASH_PATTERN, 'dash')
  boundaries.sort((a, b) => a.normalizedPosition - b.normalizedPosition)

  return {
    boundaries,
    hasTerminalPunctuation: TERMINAL_PATTERN.test(text.trim()),
  }
}

function clampPosition(value: number): number {
  return Math.max(0, Math.min(1, value))
}
