import { type DesktopWorkflowRequest, desktopWorkflowRequestSchema } from '../actions'

const ACTION_MARKER = /\s*<shio-action>([\s\S]*?)<\/shio-action>\s*$/i
const ACTION_MARKER_OPEN = /<shio-action\b/i
const ACTION_MARKER_LIKE = /<\/?shio-action\b/i
const ACTION_MARKER_TOKEN = /<\/?shio-action\b[^>]*>?/gi

export type CharacterActionResponse =
  | { kind: 'none'; replyText: string }
  | { kind: 'action'; replyText: string; request: DesktopWorkflowRequest }
  | {
      kind: 'malformed'
      replyText: string
      reason: 'invalid-envelope' | 'invalid-json' | 'invalid-schema'
      issuePaths?: readonly string[]
    }

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
      ? {
          kind: 'malformed',
          replyText: containMalformedActionMarker(text),
          reason: 'invalid-envelope',
        }
      : { kind: 'none', replyText: text }
  }

  const replyText = text.replace(ACTION_MARKER, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch {
    return { kind: 'malformed', replyText, reason: 'invalid-json' }
  }
  const request = desktopWorkflowRequestSchema.safeParse(parsed)
  return request.success
    ? { kind: 'action', replyText, request: request.data }
    : {
        kind: 'malformed',
        replyText,
        reason: 'invalid-schema',
        issuePaths: [...new Set(request.error.issues.map((issue) => issue.path.join('.')))].slice(
          0,
          8,
        ),
      }
}
