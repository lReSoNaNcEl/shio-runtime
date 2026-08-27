import type {
  MemoryRuntimeStatus,
  MemoryToolName,
  MemoryToolRequest,
  MemoryToolResult,
} from '../../shared/memory'
import { MEMORY_TOOL_NAMES, memoryToolRequestSchema } from '../../shared/memory'
import {
  CHARACTER_TOOL_SPECS,
  toLlmToolJsonSchema,
} from '../character-tools/CharacterToolSpecifications'
import type { LlmToolCall, LlmToolDefinition } from '../llm'
import type { MemoryRuntime, MemoryToolExecutionContext } from './MemoryRuntime'

const NATIVE_TO_CANONICAL = {
  memory_search: 'memory.search',
  memory_store: 'memory.store',
  memory_update: 'memory.update',
  memory_forget: 'memory.forget',
  memory_list: 'memory.list',
} as const satisfies Record<string, MemoryToolName>

export const MEMORY_LLM_TOOLS: readonly LlmToolDefinition[] = Object.freeze(
  CHARACTER_TOOL_SPECS.filter((spec) => spec.id.startsWith('memory.')).map((spec) => ({
    name: spec.nativeName,
    description: spec.description,
    parameters: toLlmToolJsonSchema(spec.inputSchema),
  })),
)

export interface NativeMemoryToolExecution {
  canonicalName: MemoryToolName | null
  result: MemoryToolResult | null
  content: string
}

function invalidToolResult(name: string): NativeMemoryToolExecution {
  return {
    canonicalName: null,
    result: null,
    content: JSON.stringify({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: `Unknown memory tool: ${name}` },
    }),
  }
}

export class MemoryToolBroker {
  constructor(private readonly runtime: MemoryRuntime) {}

  availableTools(): readonly LlmToolDefinition[] {
    const status = this.runtime.status()
    return status.enabled && status.operational ? MEMORY_LLM_TOOLS : Object.freeze([])
  }

  status(): MemoryRuntimeStatus {
    return this.runtime.status()
  }

  executeNative(call: LlmToolCall, context: MemoryToolExecutionContext): NativeMemoryToolExecution {
    const canonicalName = NATIVE_TO_CANONICAL[call.name as keyof typeof NATIVE_TO_CANONICAL]
    if (!canonicalName) return invalidToolResult(call.name)
    try {
      const request = memoryToolRequestSchema.parse({
        name: canonicalName,
        input: JSON.parse(call.argumentsJson),
      }) as MemoryToolRequest
      const result = this.runtime.execute(request, context)
      return { canonicalName, result, content: JSON.stringify(result) }
    } catch {
      const result: MemoryToolResult = {
        ok: false,
        name: canonicalName,
        error: { code: 'INVALID_REQUEST', message: 'The memory request was invalid.' },
      }
      return { canonicalName, result, content: JSON.stringify(result) }
    }
  }

  executeDirective(
    request: MemoryToolRequest,
    context: MemoryToolExecutionContext,
  ): MemoryToolResult {
    return this.runtime.execute(memoryToolRequestSchema.parse(request), context)
  }

  isCanonicalToolName(value: string): value is MemoryToolName {
    return MEMORY_TOOL_NAMES.some((name) => name === value)
  }
}
