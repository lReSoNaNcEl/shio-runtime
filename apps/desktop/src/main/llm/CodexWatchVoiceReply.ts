import { z } from 'zod'

import type { AppSettings } from '../../shared/config'
import { containsCharacterProtocol } from '../character/compatibility/LegacyDirectiveContainment'
import { CODEX_DEFAULT_REASONING_EFFORT, CODEX_MODEL } from './CodexCliProvider'
import type { ChatMessage, LLMProvider, LlmRequestOptions } from './types'

const openingSchema = z
  .object({
    opening: z.string().trim().min(1).max(320),
    more: z.boolean(),
  })
  .strict()

export function codexWatchOpeningEnabled(settings: AppSettings): boolean {
  const config = settings.llm
  const model = config?.providers?.['codex-cli']
  const effort = model?.codexReasoningByModel?.[model.model] ?? CODEX_DEFAULT_REASONING_EFFORT
  return (
    config?.activeProvider === 'codex-cli' &&
    model?.model === CODEX_MODEL &&
    (effort === CODEX_DEFAULT_REASONING_EFFORT || effort === 'low') &&
    !config.roles?.characterFallbacks?.length
  )
}

/** Separate, complete CLI responses. The caller filters each segment and owns admission. */
export async function* codexWatchVoiceSegments(
  llm: LLMProvider,
  messages: readonly ChatMessage[],
  options: LlmRequestOptions & { signal: AbortSignal },
  admitted?: Promise<boolean>,
): AsyncGenerator<string> {
  if (!llm.complete) throw new Error('Missing structured watch voice transport')
  const request = { ...options, timeoutMs: 16_000 }
  const first = await llm.complete(
    [
      ...messages,
      {
        role: 'system',
        content: [
          'Return one punctuated spoken sentence in opening, normally under 100 characters. For banter or a casual take, sound like yourself in voice chat and lead with your reaction or opinion. Honor the requested register, including uncensored profanity for a roast when explicitly requested. For a factual request, lead with the requested fact and preserve exact names, digits and codes even when quoting them takes more space. No introduction or promise to look.',
          'Set more=false when that sentence answers the whole request. If the user also asked for an explanation, a list, several sentences, or further detail, set more=true and leave those remaining parts for the next response. Do not pack the explanation into opening.',
        ].join(' '),
      },
    ],
    {
      ...request,
      maxTokens: 160,
      responseSchema: {
        name: 'watch_voice_opening',
        schema: {
          type: 'object',
          properties: { opening: { type: 'string' }, more: { type: 'boolean' } },
          required: ['opening', 'more'],
          additionalProperties: false,
        },
      },
    },
  )
  options.signal.throwIfAborted()
  const { opening, more } = openingSchema.parse(JSON.parse(first.content))
  if (first.toolCalls.length || containsCharacterProtocol(opening))
    throw new Error('Invalid watch voice opening')
  yield more ? `${opening} ` : opening
  if (!more || (admitted && !(await admitted))) return
  options.signal.throwIfAborted()
  const tail = (
    await llm.chat(
      [
        ...messages,
        { role: 'assistant', content: opening },
        {
          role: 'system',
          content:
            'Continue the same spoken answer. The preceding assistant sentence is already spoken. Supply only the remaining requested details, with no repetition, greeting, internal markup or tool request. Preserve exact on-screen values and the requested language.',
        },
      ],
      request,
    )
  ).trim()
  options.signal.throwIfAborted()
  if (!tail || containsCharacterProtocol(tail)) throw new Error('Invalid watch voice continuation')
  const remaining = tail.startsWith(opening) ? tail.slice(opening.length).trimStart() : tail
  if (remaining) yield remaining
}
