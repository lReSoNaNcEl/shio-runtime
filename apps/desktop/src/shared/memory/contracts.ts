import { z } from 'zod'

export const MEMORY_KINDS = [
  'fact',
  'preference',
  'decision',
  'commitment',
  'relationship',
] as const

export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const MEMORY_LIMITS = Object.freeze({
  maxTextCharacters: 500,
  maxQueryCharacters: 500,
  maxRecordsPerStore: 8,
  maxSearchResults: 20,
  maxListResults: 50,
  maxForgetIds: 8,
  defaultSearchLimit: 8,
  defaultListLimit: 20,
})

export interface MemorySource {
  type: 'conversation' | 'manual'
  turnId?: string
}

export interface MemoryRecord {
  id: string
  kind: MemoryKind
  text: string
  source: MemorySource
  createdAt: string
  updatedAt: string
}

export interface MemoryRuntimeStatus {
  enabled: boolean
  operational: boolean
  recordCount: number
  lastErrorCode?: MemoryErrorCode
}

export interface MemorySearchInput {
  query: string
  limit?: number
}

export interface MemorySearchResult {
  items: readonly MemoryRecord[]
  truncated: boolean
}

export interface MemoryCandidate {
  kind: MemoryKind
  text: string
  sourceTurnId: string
}

export interface MemoryStoreInput {
  memories: readonly MemoryCandidate[]
}

export interface MemoryStoreResult {
  items: readonly MemoryRecord[]
}

export interface MemoryUpdateInput {
  id: string
  kind?: MemoryKind
  text?: string
}

export interface MemoryUpdateResult {
  item: MemoryRecord
}

export interface MemoryForgetInput {
  ids: readonly string[]
}

export interface MemoryForgetResult {
  forgottenIds: readonly string[]
}

export interface MemoryListInput {
  kind?: MemoryKind
  limit?: number
}

export interface MemoryListResult {
  items: readonly MemoryRecord[]
  truncated: boolean
}

export const MEMORY_TOOL_NAMES = [
  'memory.search',
  'memory.store',
  'memory.update',
  'memory.forget',
  'memory.list',
] as const

export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number]

export type MemoryToolRequest =
  | { name: 'memory.search'; input: MemorySearchInput }
  | { name: 'memory.store'; input: MemoryStoreInput }
  | { name: 'memory.update'; input: MemoryUpdateInput }
  | { name: 'memory.forget'; input: MemoryForgetInput }
  | { name: 'memory.list'; input: MemoryListInput }

export type MemoryErrorCode =
  | 'MEMORY_DISABLED'
  | 'MEMORY_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'LIMIT_EXCEEDED'
  | 'SOURCE_TURN_MISMATCH'
  | 'SENSITIVE_CONTENT'
  | 'NOT_FOUND'
  | 'NO_CHANGES'

export type MemoryToolResult =
  | {
      ok: true
      name: MemoryToolName
      data:
        | MemorySearchResult
        | MemoryStoreResult
        | MemoryUpdateResult
        | MemoryForgetResult
        | MemoryListResult
    }
  | {
      ok: false
      name: MemoryToolName
      error: {
        code: MemoryErrorCode
        message: string
      }
    }

export type MemoryApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: MemoryErrorCode; message: string } }

export interface MemoryManagementApi {
  getStatus(): Promise<MemoryApiResult<MemoryRuntimeStatus>>
  setEnabled(enabled: boolean): Promise<MemoryApiResult<MemoryRuntimeStatus>>
  search(input: MemorySearchInput): Promise<MemoryApiResult<MemorySearchResult>>
  list(input: MemoryListInput): Promise<MemoryApiResult<MemoryListResult>>
  create(input: { kind: MemoryKind; text: string }): Promise<MemoryApiResult<MemoryRecord>>
  update(input: MemoryUpdateInput): Promise<MemoryApiResult<MemoryRecord>>
  forget(input: MemoryForgetInput): Promise<MemoryApiResult<MemoryForgetResult>>
  clearAll(): Promise<MemoryApiResult<{ cleared: true }>>
}

const memoryIdSchema = z.string().uuid()
const memoryTextSchema = z.string().trim().min(1).max(MEMORY_LIMITS.maxTextCharacters)
const sourceTurnIdSchema = z.string().trim().min(1).max(200)

export const memoryKindSchema = z.enum(MEMORY_KINDS)

export const memorySearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(MEMORY_LIMITS.maxQueryCharacters),
    limit: z.number().int().min(1).max(MEMORY_LIMITS.maxSearchResults).optional(),
  })
  .strict()

export const memoryCandidateSchema = z
  .object({
    kind: memoryKindSchema,
    text: memoryTextSchema,
    sourceTurnId: sourceTurnIdSchema,
  })
  .strict()

export const memoryStoreInputSchema = z
  .object({
    memories: z.array(memoryCandidateSchema).min(1).max(MEMORY_LIMITS.maxRecordsPerStore),
  })
  .strict()

export const memoryUpdateInputSchema = z
  .object({
    id: memoryIdSchema,
    kind: memoryKindSchema.optional(),
    text: memoryTextSchema.optional(),
  })
  .strict()
  .refine((input) => input.kind !== undefined || input.text !== undefined, {
    message: 'At least one update field is required',
  })

export const memoryForgetInputSchema = z
  .object({
    ids: z.array(memoryIdSchema).min(1).max(MEMORY_LIMITS.maxForgetIds),
  })
  .strict()
  .refine((input) => new Set(input.ids).size === input.ids.length, {
    message: 'Memory ids must be unique',
  })

export const memoryListInputSchema = z
  .object({
    kind: memoryKindSchema.optional(),
    limit: z.number().int().min(1).max(MEMORY_LIMITS.maxListResults).optional(),
  })
  .strict()

export const manualMemoryCreateInputSchema = z
  .object({ kind: memoryKindSchema, text: memoryTextSchema })
  .strict()

export const memoryToolRequestSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('memory.search'), input: memorySearchInputSchema }).strict(),
  z.object({ name: z.literal('memory.store'), input: memoryStoreInputSchema }).strict(),
  z.object({ name: z.literal('memory.update'), input: memoryUpdateInputSchema }).strict(),
  z.object({ name: z.literal('memory.forget'), input: memoryForgetInputSchema }).strict(),
  z.object({ name: z.literal('memory.list'), input: memoryListInputSchema }).strict(),
])

export const memoryDirectiveSchema = z
  .object({ operations: z.array(memoryToolRequestSchema).min(1).max(8) })
  .strict()
