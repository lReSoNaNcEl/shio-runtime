import type { z } from 'zod'

import type { BrowserObservation } from '../../shared/browser-control'
import type { ShioCapabilitySnapshot } from '../../shared/capabilities'
import type { CharacterToolId } from '../../shared/character-tools'
import type { ProviderSchemaCapabilities } from '../../shared/llm'
import type { LlmToolDefinition } from '../llm'
import type { MemoryToolBroker } from '../memory'
import {
  CHARACTER_TOOL_SPECS,
  type CharacterToolAvailabilityContext,
  toLlmToolJsonSchema,
} from './CharacterToolSpecifications'

export interface CharacterToolDefinition {
  id: CharacterToolId
  nativeName: string
  description: string
  inputSchema: z.ZodType
  llmInputSchema: Record<string, unknown>
  availability: 'available'
}

interface CharacterToolRegistryOptions {
  projectAvailable: boolean
  webAvailable?: boolean
  goalsAvailable?: boolean
  goalCreatesAvailable?: boolean
  goalUpdatesAvailable?: boolean
  conversationThreadsAvailable?: boolean
  capabilityContext: ShioCapabilitySnapshot | null
  browserObservation: BrowserObservation | null
  memory?: MemoryToolBroker
  actionsAvailable: boolean
  browserComputerUseAvailable?: boolean
  providerSchemaCapabilities?: ProviderSchemaCapabilities
}

function browserObservationHint(observation: BrowserObservation | null): string {
  if (!observation) {
    return ' No page observation is available; call browser.observe before targeting an element.'
  }
  const refs =
    observation.interactiveElements
      .slice(0, 24)
      .map((element) => element.ref)
      .join(', ') || 'none'
  return ` Targets must use observation ${observation.observationId}; current refs are ${refs}.`
}

function resolvedDescription(
  id: CharacterToolId,
  description: string,
  observation: BrowserObservation | null,
): string {
  return ['browser.click', 'browser.fill', 'browser.select'].includes(id)
    ? `${description}${browserObservationHint(observation)}`
    : description
}

export class CharacterToolRegistry {
  private readonly tools: readonly CharacterToolDefinition[]
  private readonly byId: ReadonlyMap<CharacterToolId, CharacterToolDefinition>
  private readonly byNativeName: ReadonlyMap<string, CharacterToolDefinition>
  private readonly providerSchemaCapabilities: ProviderSchemaCapabilities

  constructor(options: CharacterToolRegistryOptions) {
    this.providerSchemaCapabilities = options.providerSchemaCapabilities ?? { oneOf: true }
    const memoryStatus = options.memory?.status()
    const context: CharacterToolAvailabilityContext = {
      projectAvailable: options.projectAvailable,
      webAvailable: options.webAvailable ?? false,
      goalsAvailable: options.goalsAvailable ?? false,
      goalCreatesAvailable: options.goalCreatesAvailable ?? false,
      goalUpdatesAvailable: options.goalUpdatesAvailable ?? false,
      conversationThreadsAvailable: options.conversationThreadsAvailable ?? false,
      memoryAvailable: Boolean(memoryStatus?.enabled && memoryStatus.operational),
      actionsAvailable: options.actionsAvailable,
      browserComputerUseAvailable: options.browserComputerUseAvailable ?? false,
      capabilityContext: options.capabilityContext,
    }
    const tools = CHARACTER_TOOL_SPECS.filter((spec) => spec.availability(context)).map((spec) =>
      Object.freeze({
        id: spec.id,
        nativeName: spec.nativeName,
        description: resolvedDescription(spec.id, spec.description, options.browserObservation),
        inputSchema: spec.inputSchema,
        llmInputSchema: toLlmToolJsonSchema(spec.inputSchema, this.providerSchemaCapabilities),
        availability: 'available' as const,
      }),
    )
    this.tools = Object.freeze(tools)
    this.byId = new Map(tools.map((tool) => [tool.id, tool]))
    this.byNativeName = new Map(tools.map((tool) => [tool.nativeName, tool]))
  }

  definitions(): readonly CharacterToolDefinition[] {
    return this.tools
  }

  schemaCapabilities(): ProviderSchemaCapabilities {
    return this.providerSchemaCapabilities
  }

  nativeDefinitions(): readonly LlmToolDefinition[] {
    return this.tools.map((tool) => ({
      name: tool.nativeName,
      description: tool.description,
      parameters: tool.llmInputSchema,
    }))
  }

  get(id: CharacterToolId): CharacterToolDefinition | undefined {
    return this.byId.get(id)
  }

  fromNativeName(name: string): CharacterToolDefinition | undefined {
    return this.byNativeName.get(name)
  }

  parseInput(id: CharacterToolId, input: unknown): Record<string, unknown> {
    const tool = this.byId.get(id)
    if (!tool) throw new Error(`Character tool is unavailable: ${id}`)
    return tool.inputSchema.parse(input) as Record<string, unknown>
  }
}
