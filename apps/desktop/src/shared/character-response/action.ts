import { type DesktopWorkflowRequest, desktopWorkflowRequestSchema } from '../actions'

const ACTION_MARKER = /\s*<shio-action>([\s\S]*?)<\/shio-action>\s*$/i
const ACTION_MARKER_OPEN = /<shio-action\b/i
const ACTION_MARKER_LIKE = /<\/?shio-action\b/i
const ACTION_MARKER_TOKEN = /<\/?shio-action\b[^>]*>?/gi

export type CharacterActionResponse =
  | { kind: 'none'; replyText: string }
  | { kind: 'action'; replyText: string; request: DesktopWorkflowRequest }
  | { kind: 'malformed'; replyText: string }

function containMalformedActionMarker(text: string): string {
  const markerStart = text.search(ACTION_MARKER_OPEN)
  if (markerStart >= 0) return text.slice(0, markerStart).trim()
  return text.replace(ACTION_MARKER_TOKEN, '').trim()
}

/** Internal action proposals are strict, bounded, and never exposed to chat, TTS, or memory. */
export function parseCharacterActionResponse(text: string): CharacterActionResponse {
  const match = text.match(ACTION_MARKER)
  if (!match) {
    return ACTION_MARKER_LIKE.test(text)
      ? { kind: 'malformed', replyText: containMalformedActionMarker(text) }
      : { kind: 'none', replyText: text }
  }

  const replyText = text.replace(ACTION_MARKER, '').trim()
  try {
    const request = desktopWorkflowRequestSchema.parse(JSON.parse(match[1]))
    return { kind: 'action', replyText, request }
  } catch {
    return { kind: 'malformed', replyText }
  }
}
