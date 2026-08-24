import { z } from 'zod'

import { type DesktopWorkflowRequest, desktopWorkflowRequestSchema } from '../../../shared/actions'
import { parseCharacterToolDirective } from '../../../shared/character-tools'
import { type MemoryToolRequest, memoryDirectiveSchema } from '../../../shared/memory'

const ACTION_MARKER = /\s*<shio-action>([\s\S]*?)<\/shio-action>\s*$/iu
const ACTION_MARKER_OPEN = /<shio-action\b/iu
const ACTION_MARKER_LIKE = /<\/?shio-action\b/iu
const ACTION_MARKER_TOKEN = /<\/?shio-action\b[^>]*>?/giu
const MEMORY_MARKER = /\s*<shio-memory>([\s\S]*?)<\/shio-memory>\s*$/iu
const MEMORY_MARKER_OPEN = /<shio-memory\b/iu
const MEMORY_MARKER_LIKE = /<\/?shio-memory\b/iu
const MEMORY_MARKER_TOKEN = /<\/?shio-memory\b[^>]*>?/giu

export type LegacyCharacterActionDirective =
  | { kind: 'none'; replyText: string }
  | { kind: 'action'; replyText: string; request: DesktopWorkflowRequest }
  | {
      kind: 'malformed'
      replyText: string
      reason: 'invalid-envelope' | 'invalid-json' | 'invalid-schema'
      issuePaths?: readonly string[]
    }

export type LegacyCharacterMemoryDirective =
  | { kind: 'none'; replyText: string }
  | { kind: 'operations'; replyText: string; operations: readonly MemoryToolRequest[] }
  | { kind: 'malformed'; replyText: string }

function containMalformedMarker(text: string, open: RegExp, token: RegExp): string {
  const markerStart = text.search(open)
  if (markerStart >= 0) return text.slice(0, markerStart).trim()
  return text.replace(token, '').trim()
}

/** @deprecated Compatibility-only containment for persisted or provider-cached action markers. */
export function parseLegacyCharacterActionDirective(text: string): LegacyCharacterActionDirective {
  const match = text.match(ACTION_MARKER)
  if (!match) {
    return ACTION_MARKER_LIKE.test(text)
      ? {
          kind: 'malformed',
          replyText: containMalformedMarker(text, ACTION_MARKER_OPEN, ACTION_MARKER_TOKEN),
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

const legacyMemoryCandidateSchema = z
  .object({
    kind: z.unknown(),
    text: z.unknown(),
    sourceTurnId: z.unknown().optional(),
  })
  .strict()

function withoutModelProvenance(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const directive = value as Record<string, unknown>
  if (!Array.isArray(directive.operations)) return value
  return {
    ...directive,
    operations: directive.operations.map((operation) => {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return operation
      const record = operation as Record<string, unknown>
      if (record.name !== 'memory.store' || !record.input || typeof record.input !== 'object') {
        return operation
      }
      const input = record.input as Record<string, unknown>
      if (!Array.isArray(input.memories)) return operation
      return {
        ...record,
        input: {
          ...input,
          memories: input.memories.map((candidate) => {
            const parsed = legacyMemoryCandidateSchema.safeParse(candidate)
            return parsed.success ? { kind: parsed.data.kind, text: parsed.data.text } : candidate
          }),
        },
      }
    }),
  }
}

/** @deprecated Compatibility-only containment for persisted or provider-cached Memory markers. */
export function parseLegacyCharacterMemoryDirective(text: string): LegacyCharacterMemoryDirective {
  const match = text.match(MEMORY_MARKER)
  if (!match) {
    return MEMORY_MARKER_LIKE.test(text)
      ? {
          kind: 'malformed',
          replyText: containMalformedMarker(text, MEMORY_MARKER_OPEN, MEMORY_MARKER_TOKEN),
        }
      : { kind: 'none', replyText: text }
  }
  const replyText = text.replace(MEMORY_MARKER, '').trim()
  try {
    const directive = memoryDirectiveSchema.parse(withoutModelProvenance(JSON.parse(match[1])))
    return { kind: 'operations', replyText, operations: Object.freeze(directive.operations) }
  } catch {
    return { kind: 'malformed', replyText }
  }
}

export function containsCharacterProtocol(text: string): boolean {
  return (
    parseCharacterToolDirective(text).kind !== 'none' ||
    parseLegacyCharacterActionDirective(text).kind !== 'none' ||
    parseLegacyCharacterMemoryDirective(text).kind !== 'none'
  )
}
