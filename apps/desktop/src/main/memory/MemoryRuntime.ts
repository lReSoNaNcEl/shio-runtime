import type {
  MemoryForgetInput,
  MemoryForgetResult,
  MemoryKind,
  MemoryListInput,
  MemoryListResult,
  MemoryRecord,
  MemoryRuntimeStatus,
  MemorySearchInput,
  MemorySearchResult,
  MemoryStoreInput,
  MemoryStoreResult,
  MemoryToolRequest,
  MemoryToolResult,
  MemoryUpdateInput,
  MemoryUpdateResult,
} from '../../shared/memory'
import {
  MEMORY_LIMITS,
  manualMemoryCreateInputSchema,
  memoryForgetInputSchema,
  memoryListInputSchema,
  memorySearchInputSchema,
  memoryStoreInputSchema,
  memoryUpdateInputSchema,
} from '../../shared/memory'
import { mainLog } from '../logging/safeLogger'
import {
  containsSensitiveMemoryContent,
  type MemoryPolicy,
  MemoryPolicyError,
} from './MemoryPolicy'
import type { MemoryRetrievalStrategy } from './MemoryRetrievalStrategy'
import type { SemanticMemoryStore } from './SemanticMemoryStore'

export interface MemoryToolExecutionContext {
  sourceTurnId: string
}

export type MemoryRuntimeListener = (status: MemoryRuntimeStatus) => void

export class MemoryRuntime {
  private readonly listeners = new Set<MemoryRuntimeListener>()
  private operational: boolean
  private lastErrorCode: MemoryRuntimeStatus['lastErrorCode']

  constructor(
    private readonly store: SemanticMemoryStore | null,
    private readonly retrieval: MemoryRetrievalStrategy | null,
    private readonly policy: MemoryPolicy,
  ) {
    this.operational = Boolean(store && retrieval)
    this.lastErrorCode = this.operational ? undefined : 'MEMORY_UNAVAILABLE'
  }

  status(): MemoryRuntimeStatus {
    if (!this.store || !this.operational) {
      return Object.freeze({
        enabled: false,
        operational: false,
        recordCount: 0,
        lastErrorCode: this.lastErrorCode ?? 'MEMORY_UNAVAILABLE',
      })
    }
    try {
      return Object.freeze({
        enabled: this.store.getEnabled(),
        operational: true,
        recordCount: this.store.count(),
      })
    } catch {
      this.markUnavailable()
      return Object.freeze({
        enabled: false,
        operational: false,
        recordCount: 0,
        lastErrorCode: 'MEMORY_UNAVAILABLE',
      })
    }
  }

  onChanged(listener: MemoryRuntimeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setEnabled(enabled: boolean): MemoryRuntimeStatus {
    const store = this.requireStore()
    try {
      store.setEnabled(enabled)
      const status = this.status()
      this.publish(status)
      return status
    } catch {
      this.markUnavailable()
      throw new MemoryPolicyError('MEMORY_UNAVAILABLE', 'Long-term memory is unavailable.')
    }
  }

  execute(request: MemoryToolRequest, context: MemoryToolExecutionContext): MemoryToolResult {
    const started = Date.now()
    try {
      const parsed = this.parseRequest(request)
      const store = this.requireStore()
      const status = this.status()
      this.policy.validate(parsed, {
        sourceTurnId: context.sourceTurnId,
        status,
        exists: (id) => store.getById(id) !== null,
      })
      const data = this.executeValidated(parsed, context)
      const count =
        'items' in data ? data.items.length : 'forgottenIds' in data ? data.forgottenIds.length : 1
      mainLog.info('[MemoryTool] completed', {
        tool: parsed.name,
        durationMs: Date.now() - started,
        records: count,
        status: 'success',
      })
      return { ok: true, name: parsed.name, data }
    } catch (error) {
      const code = error instanceof MemoryPolicyError ? error.code : 'MEMORY_UNAVAILABLE'
      if (!(error instanceof MemoryPolicyError)) this.markUnavailable()
      mainLog.warn('[MemoryTool] failed', {
        tool: request.name,
        durationMs: Date.now() - started,
        status: 'failure',
        code,
      })
      return {
        ok: false,
        name: request.name,
        error: {
          code,
          message:
            error instanceof MemoryPolicyError
              ? error.message
              : 'Long-term memory is currently unavailable.',
        },
      }
    }
  }

  searchForUi(input: MemorySearchInput): MemorySearchResult {
    const parsed = memorySearchInputSchema.parse(input)
    const limit = parsed.limit ?? MEMORY_LIMITS.defaultSearchLimit
    const items = this.requireRetrieval().search(parsed.query, limit + 1)
    return Object.freeze({
      items: Object.freeze(items.slice(0, limit)),
      truncated: items.length > limit,
    })
  }

  listForUi(input: MemoryListInput): MemoryListResult {
    const parsed = memoryListInputSchema.parse(input)
    return this.list(parsed)
  }

  createManual(input: { kind: MemoryKind; text: string }): MemoryRecord {
    const parsed = manualMemoryCreateInputSchema.parse(input)
    this.assertManualTextSafe(parsed.text)
    const [created] = this.requireStore().insertMany([
      { kind: parsed.kind, text: parsed.text, source: { type: 'manual' } },
    ])
    if (!created) throw new MemoryPolicyError('MEMORY_UNAVAILABLE', 'Memory was not created.')
    this.publish(this.status())
    return created
  }

  updateManual(input: MemoryUpdateInput): MemoryRecord {
    const parsed = memoryUpdateInputSchema.parse(input)
    if (parsed.text) this.assertManualTextSafe(parsed.text)
    const updated = this.requireStore().update(parsed.id, {
      kind: parsed.kind,
      text: parsed.text,
      source: { type: 'manual' },
    })
    if (!updated) throw new MemoryPolicyError('NOT_FOUND', 'The referenced memory does not exist.')
    return updated
  }

  forgetManual(input: MemoryForgetInput): MemoryForgetResult {
    const parsed = memoryForgetInputSchema.parse(input)
    const store = this.requireStore()
    if (parsed.ids.some((id) => !store.getById(id))) {
      throw new MemoryPolicyError('NOT_FOUND', 'At least one referenced memory does not exist.')
    }
    const forgottenIds = store.deleteMany(parsed.ids)
    this.publish(this.status())
    return Object.freeze({ forgottenIds })
  }

  clearManual(): void {
    this.requireStore().clear()
    this.publish(this.status())
  }

  close(): void {
    this.listeners.clear()
    this.store?.close()
  }

  private parseRequest(request: MemoryToolRequest): MemoryToolRequest {
    try {
      switch (request.name) {
        case 'memory.search':
          return { name: request.name, input: memorySearchInputSchema.parse(request.input) }
        case 'memory.store':
          return { name: request.name, input: memoryStoreInputSchema.parse(request.input) }
        case 'memory.update':
          return { name: request.name, input: memoryUpdateInputSchema.parse(request.input) }
        case 'memory.forget':
          return { name: request.name, input: memoryForgetInputSchema.parse(request.input) }
        case 'memory.list':
          return { name: request.name, input: memoryListInputSchema.parse(request.input) }
      }
    } catch {
      throw new MemoryPolicyError('INVALID_REQUEST', 'The memory request was invalid.')
    }
  }

  private executeValidated(
    request: MemoryToolRequest,
    context: MemoryToolExecutionContext,
  ):
    | MemorySearchResult
    | MemoryStoreResult
    | MemoryUpdateResult
    | MemoryForgetResult
    | MemoryListResult {
    switch (request.name) {
      case 'memory.search':
        return this.search(request.input)
      case 'memory.store':
        return this.storeMemories(request.input, context)
      case 'memory.update':
        return this.updateMemory(request.input, context)
      case 'memory.forget':
        return this.forget(request.input)
      case 'memory.list':
        return this.list(request.input)
    }
  }

  private search(input: MemorySearchInput): MemorySearchResult {
    const limit = input.limit ?? MEMORY_LIMITS.defaultSearchLimit
    const items = this.requireRetrieval().search(input.query, limit + 1)
    return Object.freeze({
      items: Object.freeze(items.slice(0, limit)),
      truncated: items.length > limit,
    })
  }

  private storeMemories(
    input: MemoryStoreInput,
    context: MemoryToolExecutionContext,
  ): MemoryStoreResult {
    const items = this.requireStore().insertMany(
      input.memories.map((candidate) => ({
        kind: candidate.kind,
        text: candidate.text,
        source: { type: 'conversation', turnId: context.sourceTurnId },
      })),
    )
    this.publish(this.status())
    return Object.freeze({ items })
  }

  private updateMemory(
    input: MemoryUpdateInput,
    context: MemoryToolExecutionContext,
  ): MemoryUpdateResult {
    const item = this.requireStore().update(input.id, {
      kind: input.kind,
      text: input.text,
      source: { type: 'conversation', turnId: context.sourceTurnId },
    })
    if (!item) throw new MemoryPolicyError('NOT_FOUND', 'The referenced memory does not exist.')
    return Object.freeze({ item })
  }

  private forget(input: MemoryForgetInput): MemoryForgetResult {
    const forgottenIds = this.requireStore().deleteMany(input.ids)
    this.publish(this.status())
    return Object.freeze({ forgottenIds })
  }

  private list(input: MemoryListInput): MemoryListResult {
    const limit = input.limit ?? MEMORY_LIMITS.defaultListLimit
    const items = this.requireStore().list(input.kind, limit + 1)
    return Object.freeze({
      items: Object.freeze(items.slice(0, limit)),
      truncated: items.length > limit,
    })
  }

  private assertManualTextSafe(text: string): void {
    if (containsSensitiveMemoryContent(text)) {
      throw new MemoryPolicyError(
        'SENSITIVE_CONTENT',
        'The requested memory was not stored because it appears to contain a credential or secret.',
      )
    }
  }

  private requireStore(): SemanticMemoryStore {
    if (!this.store || !this.operational) {
      throw new MemoryPolicyError('MEMORY_UNAVAILABLE', 'Long-term memory is unavailable.')
    }
    return this.store
  }

  private requireRetrieval(): MemoryRetrievalStrategy {
    if (!this.retrieval || !this.operational) {
      throw new MemoryPolicyError('MEMORY_UNAVAILABLE', 'Long-term memory is unavailable.')
    }
    return this.retrieval
  }

  private markUnavailable(): void {
    this.operational = false
    this.lastErrorCode = 'MEMORY_UNAVAILABLE'
    this.publish(this.status())
  }

  private publish(status: MemoryRuntimeStatus): void {
    for (const listener of this.listeners) listener(status)
  }
}
