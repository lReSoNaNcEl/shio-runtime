import { describe, expect, it, vi } from 'vitest'

import {
  CharacterToolLoop,
  type CharacterToolLoopStreamEvent,
} from '../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../src/main/character-tools/CharacterToolRegistry'
import type { LLMProvider } from '../../src/main/llm'
import { LlmResponseError } from '../../src/main/llm'
import type { CharacterStreamEvent } from '../../src/shared/character-stream'
import { MOTION_CATALOG_REVISION } from '../../src/shared/motion'

const envelope =
  '<shio-intent>{"version":2,"intensity":"normal","gestureHint":"greeting"}</shio-intent>'
const capabilities = {
  supportsReasoning: false,
  supportsStreaming: true,
  supportsTemperature: true,
  supportsSystemPrompt: true,
  supportsToolCalling: true,
  supportsVision: false,
  recommendedMaxTokens: 100,
}

async function run(
  stream: NonNullable<LLMProvider['stream']>,
  events: CharacterToolLoopStreamEvent[],
) {
  return new CharacterToolLoop().run({
    llm: { capabilities: () => capabilities, chat: async () => '', stream },
    providerId: 'groq',
    messages: [{ role: 'user', content: 'Привет' }],
    registry: () =>
      new CharacterToolRegistry({
        projectAvailable: false,
        webAvailable: false,
        capabilityContext: null,
        browserObservation: null,
        actionsAvailable: false,
      }),
    createDispatcher: () => ({ dispose: () => undefined }) as never,
    traceId: 'early-intent-stream',
    requestOptions: {},
    nativeToolsRejected: false,
    failureReply: 'failed',
    limitReply: 'limit',
    onStreamEvent: (event) => events.push(event),
  })
}

describe('provider-neutral early embodiment transport', () => {
  async function plannedRun(
    embodiment: unknown,
    text = '[happy]Привет!',
    streamOverride?: NonNullable<LLMProvider['stream']>,
    events: CharacterToolLoopStreamEvent[] = [],
    signal?: AbortSignal,
  ) {
    const complete = vi.fn(async () => ({
      content: '',
      toolCalls: [
        {
          id: 'plan',
          name: 'character_tool_requirement',
          argumentsJson: JSON.stringify({
            requirement: { type: 'direct-answer' },
            plannedTools: [],
            embodiment,
          }),
        },
      ],
      finishReason: 'tool_calls' as const,
    }))
    const chat = vi.fn(async () => {
      throw new Error('Unexpected additional model call')
    })
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => capabilities,
        complete,
        chat,
        stream:
          streamOverride ??
          async function* () {
            yield { type: 'text-delta', at: 2, text }
            yield { type: 'completed', at: 3, finishReason: 'stop' }
          },
      },
      providerId: 'groq',
      messages: [{ role: 'user', content: 'Покажи лисью лапку' }],
      registry: () =>
        new CharacterToolRegistry({
          projectAvailable: false,
          webAvailable: false,
          capabilityContext: null,
          browserObservation: null,
          actionsAvailable: false,
        }),
      createDispatcher: () => ({ dispose: () => undefined }) as never,
      traceId: 'typed-visual-plan',
      requestOptions: {},
      signal,
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      embodimentAvailability: {
        version: 2,
        catalogRevision: MOTION_CATALOG_REVISION,
        modelGeneration: 1,
        availableSemanticIntents: ['fox-paw', 'greeting'],
        unavailableReasons: [],
        qualification: 'qualified',
      },
      failureReply: 'failed',
      limitReply: 'limit',
      onStreamEvent: (event) => events.push(event),
    })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(chat).not.toHaveBeenCalled()
    return { events, result, complete }
  }

  it('uses the existing typed planning call when prose omits a gesture envelope', async () => {
    const selected = { intensity: 'normal', gestureHint: 'fox-paw' }
    const { events, result, complete } = await plannedRun(selected)
    expect(events.filter((event) => event.type === 'embodiment-intent')).toEqual([
      { type: 'embodiment-intent', at: 2, llmRound: 0, timing: 'early', intent: selected },
    ])
    expect(events.findIndex((event) => event.type === 'embodiment-intent')).toBeLessThan(
      events.findIndex((event) => event.type === 'text-delta'),
    )
    expect(result.embodiment).toEqual(selected)
    expect(JSON.stringify(complete.mock.calls[0])).toContain('embodiment')
  })

  it('keeps explicit absence authoritative over a conflicting prose marker', async () => {
    const { events, result } = await plannedRun(null, `[happy]${envelope}Привет!`)
    expect(events.filter((event) => event.type === 'embodiment-intent')).toEqual([])
    expect(result.embodiment).toBeNull()
  })

  it('publishes one typed selection instead of two conflicting gesture decisions', async () => {
    const selected = { intensity: 'normal', gestureHint: 'fox-paw' }
    const { events } = await plannedRun(selected, `[happy]${envelope}Смотри!`)
    expect(
      events.filter((event) => event.type === 'embodiment-intent').map((event) => event.intent),
    ).toEqual([selected])
  })

  it.each([
    { intensity: 'normal', gestureHint: 'run-script' },
    { intensity: 'normal', gestureHint: 'fox-paw', bones: [] },
    { intensity: 'normal', gestureHint: 'kiss' },
  ])(
    'contains invalid or unavailable visual data without retrying a valid tool plan',
    async (invalid) => {
      const { events, result } = await plannedRun(invalid)
      expect(events.filter((event) => event.type === 'embodiment-intent')).toEqual([])
      expect(result.embodiment).toBeNull()
      expect(result.toolEvidence.requirement).toEqual({ type: 'direct-answer' })
    },
  )

  it('delivers a validated proposal before the first safe text delta', async () => {
    const events: CharacterToolLoopStreamEvent[] = []
    await run(async function* () {
      yield { type: 'text-delta', at: 1, text: `[happy]${envelope}` }
      expect(events.filter((event) => event.type === 'embodiment-intent')).toHaveLength(0)
      yield { type: 'text-delta', at: 2, text: 'Привет! ' }
      expect(events.map((event) => event.type)).toEqual(['embodiment-intent', 'text-delta'])
      yield { type: 'completed', at: 3, finishReason: 'stop' }
    }, events)
    expect(events[0]).toMatchObject({
      type: 'embodiment-intent',
      timing: 'early',
      intent: { gestureHint: 'greeting' },
    })
    expect(
      events
        .filter((event) => event.type === 'text-delta')
        .map((event) => event.delta.text)
        .join(''),
    ).toBe('Привет! ')
  })

  it('keeps a marker-only prefix private when the round becomes a tool call', async () => {
    const events: CharacterToolLoopStreamEvent[] = []
    const stream = async function* (): AsyncGenerator<CharacterStreamEvent> {
      yield { type: 'text-delta', at: 1, text: envelope }
      yield { type: 'tool-call-start', at: 2, index: 0, id: 'tool', name: 'unknown_tool' }
      yield {
        type: 'tool-call-complete',
        at: 3,
        index: 0,
        call: { id: 'tool', name: 'unknown_tool', argumentsJson: '{}' },
      }
      yield { type: 'completed', at: 4, finishReason: 'tool_calls' }
    }
    await run(stream, events)
    expect(
      events.filter((event) => event.type === 'embodiment-intent' || event.type === 'text-delta'),
    ).toEqual([])
  })

  it('does not release a planned visual proposal for a tool-only round', async () => {
    const { events, result } = await plannedRun(
      { intensity: 'normal', gestureHint: 'fox-paw' },
      '',
      async function* () {
        yield { type: 'text-delta', at: 1, text: envelope }
        yield { type: 'tool-call-start', at: 2, index: 0, id: 'tool', name: 'unknown_tool' }
        yield {
          type: 'tool-call-complete',
          at: 3,
          index: 0,
          call: { id: 'tool', name: 'unknown_tool', argumentsJson: '{}' },
        }
        yield { type: 'completed', at: 4, finishReason: 'tool_calls' }
      },
    )
    expect(
      events.filter((event) => event.type === 'embodiment-intent' || event.type === 'text-delta'),
    ).toEqual([])
    expect(result.embodiment).toBeNull()
  })

  it('does not attach a gesture to an empty marker-only response', async () => {
    const { events, result } = await plannedRun(
      { intensity: 'normal', gestureHint: 'fox-paw' },
      '[happy]',
    )
    expect(events.filter((event) => event.type === 'embodiment-intent')).toEqual([])
    expect(result.embodiment).toBeNull()
  })

  it('keeps a planned gesture private when the provider fails before prose', async () => {
    const events: CharacterToolLoopStreamEvent[] = []
    const failure = new LlmResponseError({
      provider: 'groq',
      code: 'AUTH_ERROR',
      recoverable: false,
      message: 'local fixture',
    })
    await expect(
      plannedRun(
        { intensity: 'normal', gestureHint: 'fox-paw' },
        '',
        async function* () {
          yield { type: 'text-delta', at: 1, text: envelope }
          throw failure
        },
        events,
      ),
    ).rejects.toBe(failure)
    expect(
      events.filter((event) => event.type === 'embodiment-intent' || event.type === 'text-delta'),
    ).toEqual([])
  })

  it('discards a planned gesture and queued prose after caller cancellation', async () => {
    const events: CharacterToolLoopStreamEvent[] = []
    const abort = new AbortController()
    await expect(
      plannedRun(
        { intensity: 'normal', gestureHint: 'fox-paw' },
        '',
        async function* () {
          abort.abort()
          yield { type: 'text-delta', at: 1, text: 'Смотри!' }
          yield { type: 'completed', at: 2, finishReason: 'stop' }
        },
        events,
        abort.signal,
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(
      events.filter((event) => event.type === 'embodiment-intent' || event.type === 'text-delta'),
    ).toEqual([])
  })
})
