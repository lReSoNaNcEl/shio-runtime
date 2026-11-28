import { type ChildProcess, execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import {
  CODEX_MODEL,
  parseCodexCatalog,
  parseCodexReply,
} from '../../../src/main/llm/CodexCliProvider'
import { prepareCodexInput } from '../../../src/main/llm/CodexImageInput'
import { codexWatchOpeningEnabled } from '../../../src/main/llm/CodexWatchVoiceReply'
import { normalizeLlmConfig } from '../../../src/main/llm/config'
import { LlmGateway } from '../../../src/main/llm/LlmGateway'
import {
  createLLMProvider,
  enrichModelCatalog,
  getProviderProfile,
  invalidateModelCatalog,
  resolveModelCapabilities,
} from '../../../src/main/llm/registry'
import type { AppSettings } from '../../../src/shared/config'
import type { CodexReasoningEffort } from '../../../src/shared/llm'

vi.mock(import('node:child_process'), { spy: true })

const start = { type: 'turn.started' }
const end = { type: 'turn.completed' }
const message = { type: 'item.completed', item: { type: 'agent_message', text: 'Привет!' } }
const events = (...records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\n')

describe('Codex CLI Character provider', () => {
  it('adds the Luna preset to an existing profile without changing its active provider', () => {
    const config = normalizeLlmConfig({
      activeProvider: 'openrouter',
      providers: { openrouter: { model: 'selected-model' } },
    })
    expect(config.activeProvider).toBe('openrouter')
    expect(config.providers.openrouter.model).toBe('selected-model')
    expect(config.providers['codex-cli'].model).toBe(CODEX_MODEL)
    expect(getProviderProfile('codex-cli').requiresApiKey).toBe(false)
  })

  it('returns only the final message from a completed turn', () => {
    expect(
      parseCodexReply(
        events(
          start,
          { type: 'item.completed', item: { type: 'reasoning', text: 'private' } },
          message,
          end,
        ),
      ),
    ).toBe('Привет!')
  })

  it('exposes supported reasoning levels and preserves only valid per-model preferences', () => {
    const [luna] = parseCodexCatalog(
      JSON.stringify({
        models: [
          {
            slug: CODEX_MODEL,
            visibility: 'list',
            default_reasoning_level: 'medium',
            supported_reasoning_levels: [
              { effort: 'low' },
              { effort: 'medium' },
              { effort: 'invalid' },
            ],
          },
        ],
      }),
    )
    expect(luna.reasoning).toEqual({ levels: ['none', 'low', 'medium'], defaultLevel: 'none' })
    const config = normalizeLlmConfig({
      providers: {
        'codex-cli': {
          model: 'gpt-6-sol',
          codexReasoningByModel: {
            'gpt-6-sol': 'high',
            [CODEX_MODEL]: 'low',
            '--bad': 'medium',
            unused: 'unrecognized',
          },
        },
      },
    })
    expect(config.providers['codex-cli'].codexReasoningByModel).toEqual({
      'gpt-6-sol': 'high',
      [CODEX_MODEL]: 'low',
    })
  })

  it.skipIf(process.platform !== 'win32')(
    'starts Luna on HTTPS with none by default and honors a saved reasoning level',
    async () => {
      const exec = vi.mocked(execFile)
      vi.stubEnv('APPDATA', resolve('test-appdata'))
      exec.mockImplementation((_file, _args, _options, callback) => {
        queueMicrotask(() => callback?.(null, events(start, message, end), ''))
        return { stdin: new PassThrough(), kill: vi.fn() } as unknown as ChildProcess
      })

      const chat = (reasoningEffort?: CodexReasoningEffort) =>
        createLLMProvider({
          provider: 'codex-cli',
          model: CODEX_MODEL,
          apiKey: '',
          reasoningEffort,
        }).chat([{ role: 'user', content: 'Hello' }])

      try {
        invalidateModelCatalog('codex-cli')
        await expect(chat()).resolves.toBe('Привет!')
        enrichModelCatalog(
          'codex-cli',
          parseCodexCatalog(
            JSON.stringify({
              models: [
                {
                  slug: CODEX_MODEL,
                  visibility: 'list',
                  default_reasoning_level: 'low',
                  supported_reasoning_levels: [{ effort: 'low' }],
                },
              ],
            }),
          ),
        )
        await expect(chat()).resolves.toBe('Привет!')
        await expect(chat('low')).resolves.toBe('Привет!')
        await expect(chat('none')).resolves.toBe('Привет!')

        expect(exec).toHaveBeenCalledTimes(4)
        expect(
          exec.mock.calls.map(([, args]) =>
            args?.find((arg) => arg.startsWith('model_reasoning_effort=')),
          ),
        ).toEqual([
          'model_reasoning_effort="none"',
          'model_reasoning_effort="none"',
          'model_reasoning_effort="low"',
          'model_reasoning_effort="none"',
        ])
        for (const [, args] of exec.mock.calls) {
          expect(args).toEqual(
            expect.arrayContaining([
              'model_provider="shio_https"',
              expect.stringMatching(
                /^model_providers\.shio_https=.*base_url="https:\/\/chatgpt\.com\/backend-api\/codex".*requires_openai_auth=true.*supports_websockets=false/u,
              ),
            ]),
          )
        }
      } finally {
        invalidateModelCatalog('codex-cli')
        vi.unstubAllEnvs()
        exec.mockRestore()
      }
    },
  )

  it('keeps the short Watch Together opening available with the Luna default', () => {
    const llm = normalizeLlmConfig({ activeProvider: 'codex-cli' })
    const settings = { llm } as AppSettings
    const provider = llm.providers['codex-cli']

    expect(codexWatchOpeningEnabled(settings)).toBe(true)
    provider.codexReasoningByModel = { [CODEX_MODEL]: 'low' }
    expect(codexWatchOpeningEnabled(settings)).toBe(true)
    provider.codexReasoningByModel = { [CODEX_MODEL]: 'medium' }
    expect(codexWatchOpeningEnabled(settings)).toBe(false)
  })

  it('marks a completed CLI round with no assistant content as recoverable before any tool work', () => {
    expect(() => parseCodexReply(events(start, end))).toThrow(
      expect.objectContaining({ code: 'EMPTY_STREAM', recoverable: true }),
    )
  })

  it('rejects partial, failed and unexpected tool output', () => {
    for (const stream of [
      events(start, message),
      events(start, message, { type: 'turn.failed' }),
      events(start, { type: 'item.completed', item: { type: 'command_execution' } }, message, end),
      events(start, message, end, message),
    ])
      expect(() => parseCodexReply(stream)).toThrow()
  })

  it('retains a completed tool directive followed by an empty assistant item', () => {
    const directive =
      '<shio-tools>{"calls":[{"tool":"shell.execute","arguments":{"command":"node --version"}}]}</shio-tools>'
    const item = (text: string) => ({
      type: 'item.completed',
      item: { type: 'agent_message', text },
    })

    expect(parseCodexReply(events(start, message, item(directive), item(''), end))).toBe(directive)
  })

  it('uses the visible Codex catalog, honors model-specific vision, and restores a saved selection', () => {
    const models = [
      {
        slug: 'next-model',
        display_name: 'Next',
        visibility: 'list',
        input_modalities: ['text', 'image'],
        supported_reasoning_levels: [{ effort: 'low' }],
      },
      { slug: CODEX_MODEL, display_name: 'Luna', visibility: 'list', input_modalities: ['text'] },
      { slug: 'internal', visibility: 'hide' },
    ]
    try {
      const catalog = enrichModelCatalog('codex-cli', parseCodexCatalog(JSON.stringify({ models })))
      expect(catalog.map((model) => model.id)).toEqual(['next-model', CODEX_MODEL])
      expect(catalog[0].capabilities).toMatchObject({
        supportsVision: true,
        supportsReasoning: true,
        supportsToolCalling: false,
      })
      expect(resolveModelCapabilities('codex-cli', CODEX_MODEL).supportsVision).toBe(false)
      expect(
        normalizeLlmConfig({ providers: { 'codex-cli': { model: 'next-model' } } }).providers[
          'codex-cli'
        ].model,
      ).toBe('next-model')
    } finally {
      invalidateModelCatalog('codex-cli')
    }
    expect(resolveModelCapabilities('codex-cli', CODEX_MODEL).supportsVision).toBe(true)
  })

  it('preserves image order and keeps raw bytes out of the text prompt', () => {
    const image = {
      type: 'image',
      mimeType: 'image/png',
      bytes: Uint8Array.of(12, 34, 56),
    } as const
    const encoded = prepareCodexInput([
      { role: 'user', content: [image, { type: 'text', text: 'compare' }, image] },
    ])
    expect(encoded.images).toEqual([image, image])
    expect(JSON.parse(encoded.input)).toEqual([
      { role: 'user', content: '[Image #1]\ncompare\n[Image #2]' },
    ])
    expect(() =>
      prepareCodexInput([{ role: 'user', content: [{ ...image, bytes: new Uint8Array() }] }]),
    ).toThrow()
  })

  it('rejects unknown vision support and malformed model IDs before running the CLI', async () => {
    const gateway = new LlmGateway(() => ({ provider: 'codex-cli', model: '--other', apiKey: '' }))
    await expect(
      gateway.chat([
        {
          role: 'user',
          content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array() }],
        },
      ]),
    ).rejects.toMatchObject({ code: 'VISION_UNSUPPORTED' })
    await expect(gateway.chat([{ role: 'user', content: 'Hello' }])).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
    })
  })
})
