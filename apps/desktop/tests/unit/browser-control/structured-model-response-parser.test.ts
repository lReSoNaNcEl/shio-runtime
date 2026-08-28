import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { LlmBrowserVisualActionAdapter } from '../../../src/main/browser-control'
import { StructuredModelResponseParser } from '../../../src/main/browser-control/computer-use/StructuredModelResponseParser'

const fixtureSchema = z
  .object({
    type: z.enum(['click', 'wait']),
    observationId: z.string(),
  })
  .strict()

const parser = new StructuredModelResponseParser(fixtureSchema, 'fixture-decision')

describe('StructuredModelResponseParser', () => {
  it('accepts exactly one raw or json-fenced object', () => {
    const expected = { type: 'wait' as const, observationId: 'observation-1' }
    expect(parser.parse(JSON.stringify(expected))).toEqual(expected)
    expect(parser.parse(`\n\`\`\`json\n${JSON.stringify(expected)}\n\`\`\`\n`)).toEqual(expected)
  })

  it('rejects prose extraction and reports bounded Zod diagnostics', () => {
    expect(() =>
      parser.parse('Sure:\n{"type":"wait","observationId":"observation-1"}'),
    ).toThrowError(expect.objectContaining({ code: 'COMPUTER_USE_MODEL_INVALID_RESPONSE' }))

    try {
      parser.parse('{"type":"unknown","observationId":"observation-1"}')
      throw new Error('schema mismatch fixture was accepted')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'COMPUTER_USE_MODEL_SCHEMA_MISMATCH',
        diagnostic: {
          expectedSchema: 'fixture-decision',
          issues: [{ path: ['type'], code: 'invalid_value' }],
        },
      })
      expect(JSON.stringify(error)).not.toContain('unknown')
    }
  })
})

describe('LlmBrowserVisualActionAdapter response repair', () => {
  const observation = {
    id: 'browser-use-observation-00000000-0000-4000-8000-000000000001',
    page: { id: 'page-1', url: 'https://example.test/', title: 'Fixture' },
    viewport: { width: 800, height: 600 },
    semantic: { ariaSnapshot: '- button "Close" [ref=e1]', interactiveCount: 1 },
    visualFingerprint: '0'.repeat(60),
    capturedAt: 1,
  }
  const valid = JSON.stringify({
    type: 'click-ref',
    observationId: observation.id,
    pageId: observation.page.id,
    ref: 'e1',
  })
  const capabilities = () => ({
    supportsReasoning: false,
    supportsStreaming: false,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    supportsToolCalling: false,
    supportsVision: true,
    recommendedMaxTokens: 1_000,
  })

  it('repairs one malformed response with the same vision provider', async () => {
    const chat = vi.fn().mockResolvedValueOnce(`Sure:\n${valid}`).mockResolvedValueOnce(valid)
    const adapter = new LlmBrowserVisualActionAdapter({
      provider: () => ({ capabilities, chat }),
      modelLabel: () => 'fixture-vision',
    })

    await expect(
      adapter.decide(
        { goal: 'Close the visible dialog', observation } as never,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ type: 'click-ref', ref: 'e1' })
    expect(chat).toHaveBeenCalledTimes(2)
    expect(chat.mock.calls[1]?.[0]?.[0]?.content).toContain('Your previous response was invalid')
  })

  it('returns a typed failure after exactly one unsuccessful repair', async () => {
    const chat = vi.fn().mockResolvedValue('not-json')
    const adapter = new LlmBrowserVisualActionAdapter({
      provider: () => ({ capabilities, chat }),
      modelLabel: () => 'fixture-vision',
    })

    await expect(
      adapter.decide(
        { goal: 'Close the visible dialog', observation } as never,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'COMPUTER_USE_MODEL_INVALID_RESPONSE' })
    expect(chat).toHaveBeenCalledTimes(2)
  })
})
