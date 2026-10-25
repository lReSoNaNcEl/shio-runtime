import { stripVoiceStyleMarkers } from '../speech/voiceStyle'
import type { EmotionKey } from './contracts'
import { emotionRegistry } from './registry'

export const EMOTION_SEGMENTS_TUNING = {
  enabled: true,
  maxSegments: 3,
  maxEmotionSwitches: 2,
  expressionBlendMs: 180,
} as const

export type EmotionSegmentBoundary = 'clause' | 'sentence' | 'expressive'

export const EMOTION_BOUNDARY_GAPS: Readonly<Record<EmotionSegmentBoundary, number>> = {
  clause: 80,
  sentence: 180,
  expressive: 300,
}

export interface EmotionTextSegment {
  id: string
  index: number
  emotion: EmotionKey
  text: string
  boundaryAfter: EmotionSegmentBoundary
  targetMaxGapMs: number
}
export interface ParsedEmotionalReply {
  primaryEmotion: EmotionKey
  visibleText: string
  segments: EmotionTextSegment[]
}

export function parseEmotionalReply(
  text: string,
  options: { enabled?: boolean; maxSegments?: number } = {},
): ParsedEmotionalReply {
  text = stripVoiceStyleMarkers(text)
  const enabled = options.enabled ?? EMOTION_SEGMENTS_TUNING.enabled
  const maxSegments = Math.max(1, options.maxSegments ?? EMOTION_SEGMENTS_TUNING.maxSegments)
  const supported = new Set(emotionRegistry.supported())
  const matches = Array.from(text.matchAll(/\[([a-z_ -]+)\]/gi)).filter((match) =>
    supported.has(key(match[1])),
  )
  const primaryEmotion = matches[0]
    ? emotionRegistry.normalize(matches[0][1])
    : emotionRegistry.defaultEmotion
  if (!enabled) {
    const visibleText = emotionRegistry.stripEmotionTags(text)
    return {
      primaryEmotion,
      visibleText,
      segments: visibleText
        ? [toSegment({ emotion: primaryEmotion, text: visibleText }, 0, resolveBoundaryAfter(text))]
        : [],
    }
  }
  const rawSegments: Array<{
    emotion: EmotionKey
    text: string
    boundaryAfter: EmotionSegmentBoundary
  }> = []
  let emotion = primaryEmotion
  let cursor = 0
  const append = (raw: string): void => {
    const cleaned = raw.trim()
    if (!cleaned) return
    const boundaryAfter = resolveBoundaryAfter(raw)
    const last = rawSegments.at(-1)
    if (last?.emotion === emotion || rawSegments.length >= maxSegments) {
      if (last) {
        last.text += ` ${cleaned}`
        last.boundaryAfter = boundaryAfter
      } else rawSegments.push({ emotion, text: cleaned, boundaryAfter })
    } else {
      rawSegments.push({ emotion, text: cleaned, boundaryAfter })
    }
  }
  for (const match of matches) {
    const start = match.index ?? 0
    append(text.slice(cursor, start))
    if (rawSegments.length < maxSegments) emotion = emotionRegistry.normalize(match[1])
    cursor = start + match[0].length
  }
  append(text.slice(cursor))
  const segments = rawSegments.map((segment, index) => toSegment(segment, index))
  return {
    primaryEmotion,
    visibleText: segments.map((segment) => segment.text).join(' '),
    segments,
  }
}

function toSegment(
  segment: {
    emotion: EmotionKey
    text: string
    boundaryAfter?: EmotionSegmentBoundary
  },
  index: number,
  boundaryOverride?: EmotionSegmentBoundary,
): EmotionTextSegment {
  const boundaryAfter =
    boundaryOverride ?? segment.boundaryAfter ?? resolveBoundaryAfter(segment.text)
  return {
    ...segment,
    id: `segment-${index}`,
    index,
    boundaryAfter,
    targetMaxGapMs: EMOTION_BOUNDARY_GAPS[boundaryAfter],
  }
}

function resolveBoundaryAfter(text: string): EmotionSegmentBoundary {
  if (/\r?\n\s*\r?\n\s*$/u.test(text)) return 'expressive'
  const trimmed = text.trimEnd()
  if (/(?:\.\.\.|…)$/u.test(trimmed)) return 'expressive'
  if (/(?:[!?][!?]?|\.)$/u.test(trimmed)) return 'sentence'
  return 'clause'
}

function key(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
}
