import { SafeCharacterStreamFilter } from '../character-stream/SafeCharacterStreamFilter'
import type { EmotionKey } from './contracts'

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
  const filter = new SafeCharacterStreamFilter()
  const deltas = [...filter.push(text), ...filter.flush()]
  const enabled = options.enabled ?? EMOTION_SEGMENTS_TUNING.enabled
  const maxSegments = Math.max(1, options.maxSegments ?? EMOTION_SEGMENTS_TUNING.maxSegments)
  const primaryEmotion =
    deltas.find((delta) => delta.text.trim())?.emotion ?? filter.currentEmotion()
  const visibleText = deltas
    .map((delta) => delta.text)
    .join('')
    .trim()
  if (!enabled) {
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
  const append = (raw: string, emotion: string): void => {
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
  for (const delta of deltas) append(delta.text, delta.emotion)
  const segments = rawSegments.map((segment, index) => toSegment(segment, index))
  return {
    primaryEmotion,
    visibleText,
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
