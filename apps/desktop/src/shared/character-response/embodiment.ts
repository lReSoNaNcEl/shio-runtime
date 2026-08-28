import { containInternalReasoning } from './reasoning'

export const EMBODIMENT_INTENSITIES = ['subtle', 'normal', 'strong'] as const
export const EMBODIMENT_GESTURE_HINTS = [
  'explain',
  'agree',
  'disagree',
  'tease',
  'surprise',
  'think',
  'celebrate',
] as const
export const EMBODIMENT_GAZE_HINTS = ['user', 'screen', 'away'] as const

export type EmbodimentIntensity = (typeof EMBODIMENT_INTENSITIES)[number]
export type EmbodimentGestureHint = (typeof EMBODIMENT_GESTURE_HINTS)[number]
export type EmbodimentGazeHint = (typeof EMBODIMENT_GAZE_HINTS)[number]

/** Provider-agnostic visual proposal; Avatar Runtime owns concrete execution. */
export interface CharacterEmbodimentIntent {
  intensity: EmbodimentIntensity
  gestureHint?: EmbodimentGestureHint
  gazeHint?: EmbodimentGazeHint
}

export interface CharacterResponseIntent {
  emotion: string
  embodiment?: CharacterEmbodimentIntent
}

const EMBODIMENT_MARKER = /\s*<shio-embodiment>([\s\S]*?)<\/shio-embodiment>\s*$/i
const EMBODIMENT_MARKER_OPEN = /<shio-embodiment\b/i
const EMBODIMENT_MARKER_LIKE = /<\/?shio-embodiment\b/i
const EMBODIMENT_MARKER_TOKEN = /<\/?shio-embodiment\b[^>]*>?/gi

function containMalformedEmbodimentMarker(text: string): string {
  const markerStart = text.search(EMBODIMENT_MARKER_OPEN)
  if (markerStart >= 0) return text.slice(0, markerStart).trim()
  return text.replace(EMBODIMENT_MARKER_TOKEN, '').trim()
}

export function normalizeCharacterEmbodimentIntent(
  value: unknown,
): CharacterEmbodimentIntent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (!EMBODIMENT_INTENSITIES.includes(input.intensity as EmbodimentIntensity)) return undefined
  if (
    input.gestureHint !== undefined &&
    !EMBODIMENT_GESTURE_HINTS.includes(input.gestureHint as EmbodimentGestureHint)
  )
    return undefined
  if (
    input.gazeHint !== undefined &&
    !EMBODIMENT_GAZE_HINTS.includes(input.gazeHint as EmbodimentGazeHint)
  )
    return undefined
  return {
    intensity: input.intensity as EmbodimentIntensity,
    ...(input.gestureHint ? { gestureHint: input.gestureHint as EmbodimentGestureHint } : {}),
    ...(input.gazeHint ? { gazeHint: input.gazeHint as EmbodimentGazeHint } : {}),
  }
}

/** Legacy text remains valid; internal marker fragments are never user-visible or spoken. */
export function parseCharacterEmbodimentResponse(text: string): {
  replyText: string
  embodimentIntent?: CharacterEmbodimentIntent
} {
  const safeText = containInternalReasoning(text).text
  const match = safeText.match(EMBODIMENT_MARKER)
  if (!match) {
    return EMBODIMENT_MARKER_LIKE.test(safeText)
      ? { replyText: containMalformedEmbodimentMarker(safeText) }
      : { replyText: safeText }
  }
  try {
    const embodimentIntent = normalizeCharacterEmbodimentIntent(JSON.parse(match[1]))
    return { replyText: safeText.replace(EMBODIMENT_MARKER, '').trim(), embodimentIntent }
  } catch {
    return { replyText: safeText.replace(EMBODIMENT_MARKER, '').trim() }
  }
}
