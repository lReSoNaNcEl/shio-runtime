import { parse as parseJson5 } from 'json5'
import { z } from 'zod'

export const CHARACTER_TOOL_IDS = [
  'project.search',
  'web.search',
  'browser.observe',
  'browser.open',
  'browser.click',
  'browser.fill',
  'browser.select',
  'browser.scroll',
  'browser.back',
  'browser.forward',
  'browser.tabs',
  'browser.switchTab',
  'browser.use',
  'browser.useStatus',
  'browser.usePause',
  'browser.useResume',
  'browser.useStop',
  'shell.execute',
  'memory.search',
  'memory.store',
  'memory.update',
  'memory.forget',
  'memory.list',
  'goal.create',
  'goal.list',
  'goal.update',
  'thread.open',
  'thread.resolve',
] as const

export type CharacterToolId = (typeof CHARACTER_TOOL_IDS)[number]

export const CHARACTER_TOOL_SOURCE_IDS = ['web', 'project', 'memory', 'browser-state'] as const

export type CharacterToolSourceId = (typeof CHARACTER_TOOL_SOURCE_IDS)[number]

export const characterToolRequirementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('direct-answer') }).strict(),
  z
    .object({
      type: z.literal('source-preferred'),
      source: z.enum(CHARACTER_TOOL_SOURCE_IDS),
    })
    .strict(),
  z
    .object({
      type: z.literal('required-source'),
      source: z.enum(CHARACTER_TOOL_SOURCE_IDS),
    })
    .strict(),
  z
    .object({
      type: z.literal('explicit-tool'),
      tool: z.enum(CHARACTER_TOOL_IDS),
    })
    .strict(),
])

export type CharacterToolRequirement = z.infer<typeof characterToolRequirementSchema>

export const initialCharacterToolPlanSchema = z
  .object({
    plannedTools: z
      .array(z.enum(CHARACTER_TOOL_IDS))
      .max(CHARACTER_TOOL_IDS.length)
      .refine((values) => new Set(values).size === values.length, 'Planned tools must be unique'),
  })
  .strict()

/** Semantic work that may be needed for the original user goal, resolved before evidence. */
export type InitialCharacterToolPlan = z.infer<typeof initialCharacterToolPlanSchema>

export const characterToolPlanningResultSchema = z
  .object({
    requirement: characterToolRequirementSchema,
    plannedTools: initialCharacterToolPlanSchema.shape.plannedTools,
  })
  .strict()

export interface TurnToolSourceEvidence {
  used: boolean
  succeeded: boolean
  resultCount?: number
  freshestSourceAt?: number
}

/** Runtime-owned bounded facts about tool work actually attempted in one conversation turn. */
export interface TurnToolEvidenceSummary {
  requirement: CharacterToolRequirement
  executedTools: readonly CharacterToolId[]
  failedTools: readonly CharacterToolId[]
  web: TurnToolSourceEvidence
  project: TurnToolSourceEvidence
  browser: TurnToolSourceEvidence
  memory: TurnToolSourceEvidence
}

export const characterToolCallSchema = z
  .object({
    tool: z.enum(CHARACTER_TOOL_IDS),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict()

export type CharacterToolCall = z.infer<typeof characterToolCallSchema>

export const characterToolDirectiveSchema = z
  .object({
    plannedTools: z
      .array(z.enum(CHARACTER_TOOL_IDS))
      .min(1)
      .max(16)
      .refine((values) => new Set(values).size === values.length, 'Planned tools must be unique')
      .optional(),
    calls: z.array(characterToolCallSchema).min(1).max(16),
  })
  .strict()

const NATIVE_CHARACTER_TOOL_IDS: Readonly<Record<string, CharacterToolId>> = Object.freeze(
  Object.fromEntries(CHARACTER_TOOL_IDS.map((id) => [id.replace('.', '_'), id])),
)

const CHARACTER_TOOLS_MARKER = /<shio-tools>([\s\S]*?)<\/shio-tools>/iu
const CHARACTER_TOOLS_UNCLOSED_MARKER = /<shio-tools>([\s\S]*)$/iu
const CHARACTER_TOOLS_MARKER_OPEN = /<shio-tools\b/iu
const CHARACTER_TOOLS_MARKER_LIKE = /<\/?shio-tools\b/iu
const CHARACTER_TOOLS_MARKER_TOKEN = /<\/?shio-tools\b[^>]*>?/giu
const PROVIDER_TOOL_MARKER_LIKE = /\\?<\s*\/?\s*(?:tool\\?_calls?|function\\?_call)(?=[\s>]|$)/iu
const COMPACT_TOOL_MARKER =
  /\[(?:project|web|browser|shell|memory|goal|thread)\.[A-Za-z][A-Za-z0-9]*\]/u
const PROTOCOL_FENCE = /^\s*```(?:json|xml|text)?\s*([\s\S]*?)\s*```\s*$/iu

export type CharacterToolDirective =
  | { kind: 'none'; replyText: string }
  | {
      kind: 'calls'
      replyText: string
      calls: readonly CharacterToolCall[]
      plannedTools?: readonly CharacterToolId[]
      recovered?: 'unclosed-marker'
    }
  | { kind: 'malformed'; replyText: string; source?: 'provider-control' }

function containMalformedMarker(text: string): string {
  const markerStart = text.search(CHARACTER_TOOLS_MARKER_OPEN)
  if (markerStart >= 0) return text.slice(0, markerStart).trim()
  return text.replace(CHARACTER_TOOLS_MARKER_TOKEN, '').trim()
}

function jsonObjectEnd(text: string, start: number): number | null {
  if (text[start] !== '{') return null
  let depth = 0
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return null
}

function unwrapProtocolFence(text: string): string {
  return text.match(PROTOCOL_FENCE)?.[1] ?? text
}

function repairMissingCallObjectClosure(value: string): string {
  return value.replace(/\}(\s*),(\s*)\{(?=\s*["']?(?:tool|name|function)["']?\s*:)/gu, '}}$1,$2{')
}

function repairSingleMissingObjectClosureBeforeArray(value: string): string {
  const stack: Array<'{' | '['> = []
  let quote: '"' | "'" | null = null
  let escaped = false
  let insertionIndex: number | null = null

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '{' || character === '[') {
      stack.push(character)
      continue
    }
    if (character === '}') {
      if (stack.pop() !== '{') return value
      continue
    }
    if (character !== ']') continue

    if (stack.at(-1) === '{' && stack.at(-2) === '[') {
      if (insertionIndex !== null) return value
      insertionIndex = index
      stack.pop()
    }
    if (stack.pop() !== '[') return value
  }

  if (quote || insertionIndex === null || stack.length > 0) return value
  return `${value.slice(0, insertionIndex)}}${value.slice(insertionIndex)}`
}

function parseProtocolJson(value: string): unknown {
  const unwrapped = unwrapProtocolFence(value)
  if (unwrapped.length > 50_000) throw new Error('tool protocol JSON exceeds the size limit')
  try {
    return JSON.parse(unwrapped) as unknown
  } catch {
    try {
      return parseJson5(unwrapped) as unknown
    } catch {
      const repairedCallSeparators = repairMissingCallObjectClosure(unwrapped)
      try {
        return parseJson5(repairedCallSeparators) as unknown
      } catch {
        return parseJson5(
          repairSingleMissingObjectClosureBeforeArray(repairedCallSeparators),
        ) as unknown
      }
    }
  }
}

function normalizedToolId(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return NATIVE_CHARACTER_TOOL_IDS[value] ?? value
}

function normalizedArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return parseProtocolJson(value)
  } catch {
    return value
  }
}

function normalizedToolCall(value: unknown): CharacterToolCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return characterToolCallSchema.parse(value)
  }
  const record = value as Record<string, unknown>
  const functionCall =
    record.function && typeof record.function === 'object' && !Array.isArray(record.function)
      ? (record.function as Record<string, unknown>)
      : undefined
  return characterToolCallSchema.parse({
    tool: normalizedToolId(record.tool ?? record.name ?? functionCall?.name),
    arguments: normalizedArguments(
      record.arguments ?? record.input ?? record.parameters ?? functionCall?.arguments,
    ),
  })
}

function parseDirectivePayload(value: string): {
  calls: readonly CharacterToolCall[]
  plannedTools?: readonly CharacterToolId[]
} {
  const parsed = parseProtocolJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('tool directive must be an object')
  }
  const record = parsed as Record<string, unknown>
  const calls = record.calls ?? record.tool_calls
  if (!Array.isArray(calls) || calls.length < 1 || calls.length > 16) {
    throw new Error('tool directive calls are invalid')
  }
  const normalizedCalls = Object.freeze(calls.map(normalizedToolCall))
  const planned = record.plannedTools ?? record.planned_tools
  if (planned === undefined) return { calls: normalizedCalls }
  if (!Array.isArray(planned)) throw new Error('tool directive planned tools are invalid')
  const plannedTools = characterToolDirectiveSchema.shape.plannedTools
    .unwrap()
    .parse(planned.map(normalizedToolId))
  return { calls: normalizedCalls, plannedTools: Object.freeze(plannedTools) }
}

function parseCompactToolDirective(text: string): CharacterToolDirective | null {
  const firstMarker = text.search(COMPACT_TOOL_MARKER)
  if (firstMarker < 0) return null
  const replyText = text.slice(0, firstMarker).trim()
  const calls: CharacterToolCall[] = []
  let cursor = firstMarker
  try {
    while (cursor < text.length) {
      while (/\s/u.test(text[cursor] ?? '')) cursor += 1
      if (cursor >= text.length) break
      const marker = text
        .slice(cursor)
        .match(/^\[((?:project|web|browser|shell|memory|goal|thread)\.[^\]]+)\]/u)
      if (!marker) {
        if (calls.length > 0) break
        throw new Error('missing compact tool marker')
      }
      cursor += marker[0].length
      while (/\s/u.test(text[cursor] ?? '')) cursor += 1
      if (text[cursor] === ':') {
        cursor += 1
        while (/\s/u.test(text[cursor] ?? '')) cursor += 1
      }
      const argumentsFence = text.slice(cursor).match(/^```(?:json)?\s*/iu)?.[0]
      if (argumentsFence) cursor += argumentsFence.length
      const end = jsonObjectEnd(text, cursor)
      if (end === null) throw new Error('invalid compact tool arguments')
      calls.push(
        characterToolCallSchema.parse({
          tool: marker[1],
          arguments: parseProtocolJson(text.slice(cursor, end)),
        }),
      )
      if (calls.length > 16) throw new Error('compact tool call limit exceeded')
      cursor = end
      if (argumentsFence) {
        while (/\s/u.test(text[cursor] ?? '')) cursor += 1
        if (!text.startsWith('```', cursor)) throw new Error('unterminated argument fence')
        cursor += 3
      }
    }
    if (calls.length === 0) throw new Error('compact tool call missing')
    return { kind: 'calls', replyText, calls: Object.freeze(calls) }
  } catch {
    return { kind: 'malformed', replyText }
  }
}

/** Provider-neutral structured tool calls produced by the Character LLM. */
export function parseCharacterToolDirective(text: string): CharacterToolDirective {
  const providerMarker = PROVIDER_TOOL_MARKER_LIKE.exec(text)
  if (providerMarker) {
    return {
      kind: 'malformed',
      replyText: text.slice(0, providerMarker.index).trim(),
      source: 'provider-control',
    }
  }
  const unwrapped = unwrapProtocolFence(text)
  const candidate =
    CHARACTER_TOOLS_MARKER_LIKE.test(unwrapped) || COMPACT_TOOL_MARKER.test(unwrapped)
      ? unwrapped
      : text
  const match = candidate.match(CHARACTER_TOOLS_MARKER)
  if (!match) {
    if (CHARACTER_TOOLS_MARKER_LIKE.test(candidate)) {
      const unclosed = candidate.match(CHARACTER_TOOLS_UNCLOSED_MARKER)
      const markerCount = candidate.match(/<shio-tools\b/giu)?.length ?? 0
      const closingMarkerCount = candidate.match(/<\/shio-tools>/giu)?.length ?? 0
      if (unclosed && markerCount === 1 && closingMarkerCount === 0) {
        const replyText = candidate.slice(0, unclosed.index).trim()
        try {
          const payload = parseDirectivePayload(unclosed[1])
          return {
            kind: 'calls',
            replyText,
            calls: payload.calls,
            ...(payload.plannedTools ? { plannedTools: payload.plannedTools } : {}),
            recovered: 'unclosed-marker',
          }
        } catch {
          return { kind: 'malformed', replyText }
        }
      }
      return { kind: 'malformed', replyText: containMalformedMarker(candidate) }
    }
    return parseCompactToolDirective(candidate) ?? { kind: 'none', replyText: text }
  }
  const markerCount = candidate.match(/<shio-tools\b/giu)?.length ?? 0
  const closingMarkerCount = candidate.match(/<\/shio-tools>/giu)?.length ?? 0
  const replyText = candidate.slice(0, match.index).trim()
  try {
    if (markerCount !== 1 || closingMarkerCount !== 1) throw new Error('ambiguous tool markers')
    const payload = parseDirectivePayload(match[1])
    return {
      kind: 'calls',
      replyText,
      calls: payload.calls,
      ...(payload.plannedTools ? { plannedTools: payload.plannedTools } : {}),
    }
  } catch {
    return { kind: 'malformed', replyText }
  }
}
