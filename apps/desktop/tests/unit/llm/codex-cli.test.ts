import { describe, expect, it } from 'vitest'

import {
  CODEX_MODEL,
  parseCodexCatalog,
  parseCodexReply,
} from '../../../src/main/llm/CodexCliProvider'
import { prepareCodexInput } from '../../../src/main/llm/CodexImageInput'
import { normalizeLlmConfig } from '../../../src/main/llm/config'
import { LlmGateway } from '../../../src/main/llm/LlmGateway'
import {
  enrichModelCatalog,
  getProviderProfile,
  invalidateModelCatalog,
  resolveModelCapabilities,
} from '../../../src/main/llm/registry'

const start = { type: 'turn.started' }
const end = { type: 'turn.completed' }
const message = { type: 'item.completed', item: { type: 'agent_message', text: 'Привет!' } }
const events = (...records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\n')

describe('Codex CLI Character provider', () => {
  it('adds the Luna preset to an existing profile without changing its active provider', () => {
    const config = normalizeLlmConfig({
      activeProvider: 'mistral',
      providers: { mistral: { model: 'selected-model' } },
    })
    expect(config.activeProvider).toBe('mistral')
    expect(config.providers.mistral.model).toBe('selected-model')
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
    expect(luna.reasoning).toEqual({ levels: ['low', 'medium'], defaultLevel: 'low' })
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

  it('rejects partial, failed and unexpected tool output', () => {
    for (const stream of [
      events(start, message),
      events(start, message, { type: 'turn.failed' }),
      events(start, { type: 'item.completed', item: { type: 'command_execution' } }, message, end),
      events(start, message, end, message),
    ])
      expect(() => parseCodexReply(stream)).toThrow()
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
