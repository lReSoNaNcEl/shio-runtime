import { describe, expect, it } from 'vitest'

import { CharacterToolRegistry } from '../../../src/main/character-tools/CharacterToolRegistry'
import {
  CHARACTER_TOOL_SPECS,
  goalUpdateInputSchema,
  toLlmToolJsonSchema,
} from '../../../src/main/character-tools/CharacterToolSpecifications'
import { CHARACTER_TOOL_IDS } from '../../../src/shared/character-tools'

describe('canonical Character tool schemas', () => {
  it('covers every Character tool exactly once', () => {
    const ids = CHARACTER_TOOL_SPECS.map((tool) => tool.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([...CHARACTER_TOOL_IDS].sort())
  })

  it('derives bounded Draft 7 input schemas from the runtime Zod schemas', () => {
    const allowedKeywords = new Set([
      'type',
      'properties',
      'required',
      'additionalProperties',
      'enum',
      'const',
      'items',
      'integer',
      'minimum',
      'maximum',
      'oneOf',
    ])
    const assertPortable = (node: unknown, path: string): void => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return
      const record = node as Record<string, unknown>
      for (const key of Object.keys(record)) {
        expect(allowedKeywords.has(key), `${path}.${key}`).toBe(true)
      }
      if (record.properties && typeof record.properties === 'object') {
        for (const [key, value] of Object.entries(record.properties)) {
          assertPortable(value, `${path}.properties.${key}`)
        }
      }
      if (record.items) assertPortable(record.items, `${path}.items`)
      if (Array.isArray(record.oneOf)) {
        for (const [index, value] of record.oneOf.entries()) {
          assertPortable(value, `${path}.oneOf.${index}`)
        }
      }
    }
    for (const tool of CHARACTER_TOOL_SPECS) {
      const jsonSchema = toLlmToolJsonSchema(tool.inputSchema)
      expect(jsonSchema.type, tool.id).toBe('object')
      expect(jsonSchema).not.toHaveProperty('$schema')
      expect(jsonSchema).not.toHaveProperty('default')
      assertPortable(jsonSchema, tool.id)
      expect(JSON.stringify(jsonSchema).length, tool.id).toBeLessThan(30_000)
    }
    const browserUse = CHARACTER_TOOL_SPECS.find((tool) => tool.id === 'browser.use')
    expect(browserUse).toBeDefined()
    if (!browserUse) throw new Error('browser.use schema is missing')
    expect(browserUse.description).toContain('{"type":"goal-completed"}')
    expect(JSON.stringify(toLlmToolJsonSchema(browserUse.inputSchema))).toContain('oneOf')
    const portableBrowserUse = toLlmToolJsonSchema(browserUse.inputSchema, { oneOf: false })
    expect(JSON.stringify(portableBrowserUse)).not.toContain('oneOf')
    expect(portableBrowserUse).toHaveProperty('properties.termination', {
      type: 'object',
      required: ['type'],
      properties: {
        type: { enum: ['goal-completed', 'until-stopped', 'until-time'] },
        durationMs: { type: 'integer', minimum: 10_000, maximum: 7_200_000 },
      },
      additionalProperties: false,
    })
    const browserUseStatus = CHARACTER_TOOL_SPECS.find((tool) => tool.id === 'browser.useStatus')
    expect(browserUseStatus?.description).toContain('waitForTerminalMs')
    expect(browserUseStatus?.inputSchema.parse({ waitForTerminalMs: 15_000 })).toEqual({
      waitForTerminalMs: 15_000,
    })
    expect(() => browserUseStatus?.inputSchema.parse({ waitForTerminalMs: 15_001 })).toThrow()

    const shellExecute = CHARACTER_TOOL_SPECS.find((tool) => tool.id === 'shell.execute')
    expect(shellExecute?.description).toContain('npx.cmd --version')
    expect(shellExecute?.description).toContain('ExecutionPolicy')
    expect(shellExecute?.description).not.toContain('browser')
  })

  it('keeps runtime-only goal refinements authoritative', () => {
    const jsonSchema = toLlmToolJsonSchema(goalUpdateInputSchema)
    expect(jsonSchema).toHaveProperty('properties.progressPercent')
    expect(() => goalUpdateInputSchema.parse({ id: 'goal-1', progressPercent: 50 })).toThrow()
    expect(() => goalUpdateInputSchema.parse({ id: 'goal-1' })).toThrow()
    expect(
      goalUpdateInputSchema.parse({
        id: 'goal-1',
        progressPercent: 50,
        progressBasis: 'user-report',
      }),
    ).toMatchObject({ progressPercent: 50, progressBasis: 'user-report' })
  })

  it('uses the same schemas for native definitions and runtime parsing', () => {
    const registry = new CharacterToolRegistry({
      projectAvailable: true,
      webAvailable: true,
      goalsAvailable: true,
      goalCreatesAvailable: true,
      goalUpdatesAvailable: true,
      conversationThreadsAvailable: true,
      actionsAvailable: true,
      browserComputerUseAvailable: true,
      browserObservation: null,
      capabilityContext: {
        capabilities: [
          { id: 'computer-control', availability: 'available' },
          { id: 'browser-control', availability: 'available' },
          { id: 'browser-computer-use', availability: 'available' },
        ],
      } as never,
      memory: { status: () => ({ enabled: true, operational: true }) } as never,
    })
    expect(
      registry
        .nativeDefinitions()
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(CHARACTER_TOOL_SPECS.map((tool) => tool.nativeName).sort())
    expect(registry.parseInput('project.search', { query: '  actual source  ' })).toEqual({
      query: 'actual source',
    })
    expect(() =>
      registry.parseInput('project.search', { query: 'actual source', unexpected: true }),
    ).toThrow()
    for (const definition of registry.definitions()) {
      expect(definition.llmInputSchema).toEqual(toLlmToolJsonSchema(definition.inputSchema))
    }
  })

  it('projects tool definitions through the active provider schema capabilities', () => {
    const registry = new CharacterToolRegistry({
      projectAvailable: false,
      actionsAvailable: true,
      browserComputerUseAvailable: true,
      browserObservation: null,
      capabilityContext: {
        capabilities: [
          { id: 'browser-control', availability: 'available' },
          { id: 'browser-computer-use', availability: 'available' },
        ],
      } as never,
      providerSchemaCapabilities: { oneOf: false },
    })
    const browserUse = registry.get('browser.use')

    expect(browserUse).toBeDefined()
    expect(JSON.stringify(browserUse?.llmInputSchema)).not.toContain('oneOf')
    expect(browserUse?.llmInputSchema).toHaveProperty('properties.termination.required', ['type'])
  })
})
