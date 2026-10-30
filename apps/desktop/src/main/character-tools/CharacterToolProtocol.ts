import { type CharacterToolCall, parseCharacterToolDirective } from '../../shared/character-tools'
import {
  containsCharacterProtocol,
  parseLegacyCharacterActionDirective,
  parseLegacyCharacterMemoryDirective,
} from '../character/compatibility/LegacyDirectiveContainment'

/**
 * Tool Protocol parsing for the Character Tool Loop: structured directives, legacy
 * compatibility containment, and bounded protocol-shape diagnostics. Pure functions only;
 * execution, admission, and evidence remain owned by the loop.
 */

export interface StructuredCalls {
  replyText: string
  calls: readonly CharacterToolCall[]
  plannedTools?: readonly CharacterToolCall['tool'][]
  recovered?: 'unclosed-marker'
  legacyKind?: 'action' | 'memory'
  legacyAction?: ReturnType<typeof parseLegacyCharacterActionDirective> & { kind: 'action' }
}

export function parseStructuredCalls(text: string): StructuredCalls | 'malformed' | null {
  const directive = parseCharacterToolDirective(text)
  if (directive.kind === 'calls') {
    return {
      replyText: directive.replyText,
      calls: directive.calls,
      plannedTools: directive.plannedTools,
      recovered: directive.recovered,
    }
  }
  if (directive.kind === 'malformed') return 'malformed'

  // Compatibility containment for already persisted/provider-cached structured protocols.
  const memory = parseLegacyCharacterMemoryDirective(text)
  if (memory.kind === 'operations') {
    return {
      replyText: memory.replyText,
      legacyKind: 'memory',
      calls: memory.operations.map((operation) => ({
        tool: operation.name,
        arguments: operation.input as unknown as Record<string, unknown>,
      })),
    }
  }
  if (memory.kind === 'malformed') return 'malformed'

  const action = parseLegacyCharacterActionDirective(text)
  if (action.kind === 'action')
    return { replyText: action.replyText, calls: [], legacyKind: 'action', legacyAction: action }
  if (action.kind === 'malformed') return 'malformed'
  return null
}

export function containsToolProtocol(text: string): boolean {
  return containsCharacterProtocol(text)
}

export function protocolShape(text: string): {
  responseCharacters: number
  markers: readonly string[]
  fenced: boolean
  payload?: {
    json: 'valid' | 'invalid'
    characters: number
    topLevelKeys?: readonly string[]
    calls?: readonly {
      keys: readonly string[]
      functionKeys?: readonly string[]
      toolId?: string
      argumentsType?: string
    }[]
  }
} {
  const markers = Array.from(
    text.matchAll(/<\/?shio-(?:tools|action|memory)\b|\[([A-Za-z][A-Za-z0-9.-]*)\]/giu),
    (match) => (match[1] ? `[${match[1]}]` : match[0].toLowerCase()),
  ).slice(0, 20)
  const payloadText = text.match(/<shio-tools>([\s\S]*?)<\/shio-tools>/iu)?.[1]
  let payload:
    | {
        json: 'valid' | 'invalid'
        characters: number
        topLevelKeys?: readonly string[]
        calls?: readonly {
          keys: readonly string[]
          functionKeys?: readonly string[]
          toolId?: string
          argumentsType?: string
        }[]
      }
    | undefined
  if (payloadText !== undefined) {
    try {
      const parsed: unknown = JSON.parse(payloadText)
      const record =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : undefined
      const rawCalls = record?.calls ?? record?.tool_calls
      payload = {
        json: 'valid',
        characters: payloadText.length,
        topLevelKeys: safeProtocolKeys(record),
        calls: Array.isArray(rawCalls)
          ? rawCalls.slice(0, 16).map((rawCall) => {
              const call =
                rawCall && typeof rawCall === 'object' && !Array.isArray(rawCall)
                  ? (rawCall as Record<string, unknown>)
                  : undefined
              const fn =
                call?.function && typeof call.function === 'object' && !Array.isArray(call.function)
                  ? (call.function as Record<string, unknown>)
                  : undefined
              const toolId = call?.tool ?? call?.name ?? fn?.name
              const argumentsValue =
                call?.arguments ?? call?.input ?? call?.parameters ?? fn?.arguments
              return {
                keys: safeProtocolKeys(call),
                functionKeys: fn ? safeProtocolKeys(fn) : undefined,
                toolId:
                  typeof toolId === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(toolId)
                    ? toolId
                    : undefined,
                argumentsType: protocolValueType(argumentsValue),
              }
            })
          : undefined,
      }
    } catch {
      payload = { json: 'invalid', characters: payloadText.length }
    }
  }
  return {
    responseCharacters: text.length,
    markers,
    fenced: text.trimStart().startsWith('```') || text.trimEnd().endsWith('```'),
    payload,
  }
}

function safeProtocolKeys(value: Record<string, unknown> | undefined): readonly string[] {
  if (!value) return []
  return Object.keys(value)
    .filter((key) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key))
    .slice(0, 16)
}

function protocolValueType(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function safeArguments(argumentsJson: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
