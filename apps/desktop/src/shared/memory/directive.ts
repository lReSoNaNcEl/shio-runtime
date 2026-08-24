import { type MemoryToolRequest, memoryDirectiveSchema } from './contracts'

const MEMORY_MARKER = /\s*<shio-memory>([\s\S]*?)<\/shio-memory>\s*$/iu
const MEMORY_MARKER_OPEN = /<shio-memory\b/iu
const MEMORY_MARKER_LIKE = /<\/?shio-memory\b/iu
const MEMORY_MARKER_TOKEN = /<\/?shio-memory\b[^>]*>?/giu

export type CharacterMemoryDirective =
  | { kind: 'none'; replyText: string }
  | { kind: 'operations'; replyText: string; operations: readonly MemoryToolRequest[] }
  | { kind: 'malformed'; replyText: string }

function containMalformedMarker(text: string): string {
  const markerStart = text.search(MEMORY_MARKER_OPEN)
  if (markerStart >= 0) return text.slice(0, markerStart).trim()
  return text.replace(MEMORY_MARKER_TOKEN, '').trim()
}

/** Provider-neutral semantic directives are model output, never a natural-language intent parser. */
export function parseCharacterMemoryDirective(text: string): CharacterMemoryDirective {
  const match = text.match(MEMORY_MARKER)
  if (!match) {
    return MEMORY_MARKER_LIKE.test(text)
      ? { kind: 'malformed', replyText: containMalformedMarker(text) }
      : { kind: 'none', replyText: text }
  }
  const replyText = text.replace(MEMORY_MARKER, '').trim()
  try {
    const directive = memoryDirectiveSchema.parse(JSON.parse(match[1]))
    return { kind: 'operations', replyText, operations: Object.freeze(directive.operations) }
  } catch {
    return { kind: 'malformed', replyText }
  }
}
