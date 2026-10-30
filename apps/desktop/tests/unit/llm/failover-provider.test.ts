import { describe, expect, it } from 'vitest'

import { defaultLlmConfig, normalizeLlmConfig } from '../../../src/main/llm/config'
import { LlmCredentialMissingError, LlmResponseError } from '../../../src/main/llm/errors'
import {
  type FailoverCandidate,
  FailoverLlmProvider,
  failoverDisposition,
} from '../../../src/main/llm/FailoverLlmProvider'
import type { LLMProvider } from '../../../src/main/llm/types'
import type { CharacterStreamEvent } from '../../../src/shared/character-stream'
import type { LlmTurnErrorCode } from '../../../src/shared/llm'

const failure = (code: LlmTurnErrorCode, recoverable = true) =>
  new LlmResponseError({ provider: 'groq', code, recoverable, message: code })

function candidate(
  label: string,
  provider: Partial<LLMProvider>,
  calls: string[],
): FailoverCandidate {
  return {
    label,
    provider: () => {
      calls.push(label)
      return { chat: async () => '', ...provider } as LLMProvider
    },
  }
}

async function collect(stream: AsyncIterable<CharacterStreamEvent>) {
  const events: CharacterStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe('pre-byte LLM failover', () => {
  it('classifies only transient and credential failures as failover', () => {
    for (const code of [
      'RATE_LIMITED',
      'NETWORK_ERROR',
      'TIMEOUT',
      'AUTH_ERROR',
      'ACCESS_DENIED',
    ] as const)
      expect(failoverDisposition(failure(code))).toBe('next')
    expect(failoverDisposition(failure('PROVIDER_REJECTED', true))).toBe('next')
    expect(failoverDisposition(failure('PROVIDER_REJECTED', false))).toBe('stop')
    for (const code of [
      'CANCELLED',
      'INVALID_STREAM_CHUNK',
      'INCOMPLETE_TOOL_CALL',
      'REQUEST_TOO_LARGE',
      'UNKNOWN',
    ] as const)
      expect(failoverDisposition(failure(code))).toBe('stop')
    expect(failoverDisposition(new LlmCredentialMissingError())).toBe('next')
    expect(failoverDisposition(new Error('validation'))).toBe('stop')
  })

  it('serves a rate-limited request from the next candidate and reports which one served', async () => {
    const calls: string[] = []
    const served: Array<{ label: string; attempt: number }> = []
    const provider = new FailoverLlmProvider(
      () => [
        candidate('primary', { chat: async () => Promise.reject(failure('RATE_LIMITED')) }, calls),
        candidate('backup', { chat: async () => '[calm]Ответ.' }, calls),
      ],
      { onServed: (event) => served.push(event) },
    )
    expect(await provider.chat([])).toBe('[calm]Ответ.')
    expect(calls).toEqual(['primary', 'backup'])
    expect(served).toEqual([{ label: 'backup', attempt: 1 }])
  })

  it('skips a candidate without credentials and never retries an auth failure on itself', async () => {
    const calls: string[] = []
    const provider = new FailoverLlmProvider(() => [
      {
        label: 'missing',
        provider: () => {
          calls.push('missing')
          throw new LlmCredentialMissingError()
        },
      },
      candidate(
        'denied',
        { chat: async () => Promise.reject(failure('AUTH_ERROR', false)) },
        calls,
      ),
      candidate('ok', { chat: async () => 'ok' }, calls),
    ])
    expect(await provider.chat([])).toBe('ok')
    expect(calls).toEqual(['missing', 'denied', 'ok'])
  })

  it('stops on cancellation and non-transient errors', async () => {
    const calls: string[] = []
    const controller = new AbortController()
    const cancelled = new FailoverLlmProvider(() => [
      candidate(
        'primary',
        {
          chat: async () => {
            controller.abort()
            throw failure('NETWORK_ERROR')
          },
        },
        calls,
      ),
      candidate('backup', { chat: async () => 'late' }, calls),
    ])
    await expect(cancelled.chat([], { signal: controller.signal })).rejects.toThrow()
    expect(calls).toEqual(['primary'])
    const rejected = new FailoverLlmProvider(() => [
      candidate(
        'primary',
        { chat: async () => Promise.reject(failure('REQUEST_TOO_LARGE', false)) },
        calls,
      ),
      candidate('backup', { chat: async () => 'never' }, calls),
    ])
    await expect(rejected.chat([])).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' })
  })

  it('fails over a stream only before its first response byte and never duplicates text', async () => {
    const calls: string[] = []
    const provider = new FailoverLlmProvider(() => [
      candidate(
        'primary',
        {
          async *stream() {
            yield { type: 'connected', at: 1 } as const
            throw failure('RATE_LIMITED')
          },
        },
        calls,
      ),
      candidate(
        'backup',
        {
          async *stream() {
            yield { type: 'connected', at: 2 } as const
            yield { type: 'first-byte', at: 3 } as const
            yield { type: 'text-delta', at: 4, text: 'Привет' } as const
          },
        },
        calls,
      ),
    ])
    const events = await collect(provider.stream([]))
    expect(events.map((event) => event.type)).toEqual(['connected', 'first-byte', 'text-delta'])
    expect(events.filter((event) => event.type === 'text-delta')).toHaveLength(1)

    const late = new FailoverLlmProvider(() => [
      candidate(
        'primary',
        {
          async *stream() {
            yield { type: 'first-byte', at: 1 } as const
            yield { type: 'text-delta', at: 2, text: 'Част' } as const
            throw failure('NETWORK_ERROR')
          },
        },
        calls,
      ),
      candidate(
        'backup',
        {
          async *stream() {
            yield { type: 'text-delta', at: 3, text: 'never' } as const
          },
        },
        calls,
      ),
    ])
    const seen: string[] = []
    await expect(
      (async () => {
        for await (const event of late.stream([]))
          if (event.type === 'text-delta') seen.push(event.text)
      })(),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(seen).toEqual(['Част'])
  })
})

describe('Character fallback config', () => {
  it('keeps ordered, bounded, known fallbacks and migrates idempotently', () => {
    const raw = {
      ...defaultLlmConfig(),
      roles: {
        ...defaultLlmConfig().roles,
        characterFallbacks: [
          { providerId: 'openrouter', model: ' a/b ' },
          { providerId: 'openrouter', model: 'a/b' },
          { providerId: 'unknown', model: 'x' },
          { providerId: 'mistral', model: '' },
          { providerId: 'mistral', model: 'mistral-small' },
          { providerId: 'groq', model: 'third' },
        ],
      },
    }
    const once = normalizeLlmConfig(raw)
    expect(once.roles.characterFallbacks).toEqual([
      { providerId: 'openrouter', model: 'a/b' },
      { providerId: 'mistral', model: 'mistral-small' },
    ])
    expect(normalizeLlmConfig(once)).toEqual(once)
    expect(normalizeLlmConfig({}).roles.characterFallbacks).toEqual([])
    expect(
      normalizeLlmConfig({ roles: { characterFallbacks: 'bad' } }).roles.characterFallbacks,
    ).toEqual([])
  })
})
