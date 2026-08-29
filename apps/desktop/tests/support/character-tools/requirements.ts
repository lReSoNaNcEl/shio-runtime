import { CharacterToolDispatcher } from '../../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolLoop } from '../../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../../src/main/character-tools/CharacterToolRegistry'
import type { LLMProvider, LlmCapabilities, LlmCompletion } from '../../../src/main/llm'
import type { CharacterToolRequirement } from '../../../src/shared/character-tools'
import type { WebSearchProvider } from '../../../src/shared/web-search'

export const capabilities: LlmCapabilities = {
  supportsReasoning: false,
  supportsStreaming: false,
  supportsTemperature: true,
  supportsSystemPrompt: true,
  supportsToolCalling: true,
  supportsVision: false,
  recommendedMaxTokens: 1_024,
}

export function registry(webAvailable: boolean): CharacterToolRegistry {
  return new CharacterToolRegistry({
    projectAvailable: false,
    webAvailable,
    capabilityContext: null,
    browserObservation: null,
    actionsAvailable: false,
  })
}

export function webCall(): LlmCompletion {
  return {
    content: '',
    toolCalls: [
      {
        id: 'web-call',
        name: 'web_search',
        argumentsJson: JSON.stringify({ query: 'Fish Audio S2.1 Pro free access end date' }),
      },
    ],
    finishReason: 'tool_calls',
  }
}

export function textCompletion(content: string): LlmCompletion {
  return { content, toolCalls: [], finishReason: 'stop' }
}

export async function runWebRequirement(options: {
  web: WebSearchProvider
  complete: NonNullable<LLMProvider['complete']>
  requirement?: CharacterToolRequirement
}) {
  const currentRegistry = () => registry(true)
  return new CharacterToolLoop().run({
    llm: {
      capabilities: () => capabilities,
      chat: async () =>
        JSON.stringify(options.requirement ?? { type: 'explicit-tool', tool: 'web.search' }),
      complete: async (messages, requestOptions) => {
        if (requestOptions?.tools?.some((tool) => tool.name === 'character_tool_requirement')) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'requirement-call',
                name: 'character_tool_requirement',
                argumentsJson: JSON.stringify(
                  options.requirement ?? { type: 'explicit-tool', tool: 'web.search' },
                ),
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        return options.complete(messages, requestOptions)
      },
    },
    providerId: 'mistral',
    messages: [
      {
        role: 'user',
        content:
          'Можешь через web.search узнать, до какого числа дают бесплатный доступ Fish Audio S2.1 Pro?',
      },
    ],
    registry: currentRegistry,
    createDispatcher: (signal) =>
      new CharacterToolDispatcher({
        registry: currentRegistry,
        traceId: 'explicit-web-search-regression',
        userGoal: 'Узнать точную дату через web.search',
        signal,
        webSearch: () => options.web,
      }),
    traceId: 'explicit-web-search-regression',
    requestOptions: {},
    nativeToolsRejected: false,
    enforceToolRequirements: true,
    requirementFailureReply: (requirement, reason) =>
      `REQUIREMENT_FAILURE:${reason}:${JSON.stringify(requirement)}`,
    failureReply: 'TOOL_FAILURE',
    limitReply: 'TOOL_LIMIT',
  })
}
