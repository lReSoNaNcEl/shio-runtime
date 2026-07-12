import { type EmotionKey, emotionRegistry } from './emotions'

export const EMOTION_SEGMENTS_TUNING = {
  enabled: true,
  maxSegments: 3,
  maxEmotionSwitches: 2,
  expressionBlendMs: 180,
} as const

export interface EmotionTextSegment {
  id: string
  index: number
  emotion: EmotionKey
  text: string
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
        ? [{ id: 'segment-0', index: 0, emotion: primaryEmotion, text: visibleText }]
        : [],
    }
  }
  const rawSegments: Array<{ emotion: EmotionKey; text: string }> = []
  let emotion = primaryEmotion
  let cursor = 0
  const append = (raw: string): void => {
    const cleaned = raw.trim()
    if (!cleaned) return
    const last = rawSegments.at(-1)
    if (last?.emotion === emotion || rawSegments.length >= maxSegments) {
      if (last) last.text += ` ${cleaned}`
      else rawSegments.push({ emotion, text: cleaned })
    } else {
      rawSegments.push({ emotion, text: cleaned })
    }
  }
  for (const match of matches) {
    const start = match.index ?? 0
    append(text.slice(cursor, start))
    if (rawSegments.length < maxSegments) emotion = emotionRegistry.normalize(match[1])
    cursor = start + match[0].length
  }
  append(text.slice(cursor))
  const segments = rawSegments.map((segment, index) => ({
    ...segment,
    id: `segment-${index}`,
    index,
  }))
  return {
    primaryEmotion,
    visibleText: segments.map((segment) => segment.text).join(' '),
    segments,
  }
}

function key(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
}
