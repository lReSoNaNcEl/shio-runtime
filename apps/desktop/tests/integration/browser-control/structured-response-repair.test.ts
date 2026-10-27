import { describe, expect, it, vi } from 'vitest'

import { LlmBrowserVisualActionAdapter } from '../../../src/main/browser-control'

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

  it('supplies the exact decision contract and directs a blank page to navigate', async () => {
    const blankObservation = {
      ...observation,
      page: { ...observation.page, url: 'about:blank', title: '' },
    }
    const navigate = JSON.stringify({
      type: 'navigate',
      observationId: blankObservation.id,
      pageId: blankObservation.page.id,
      url: 'https://example.com/',
    })
    const chat = vi.fn().mockResolvedValue(navigate)
    const adapter = new LlmBrowserVisualActionAdapter({
      provider: () => ({ capabilities, chat }),
      modelLabel: () => 'fixture-vision',
    })

    await expect(
      adapter.decide(
        {
          goal: 'Open https://example.com and read the page title',
          observation: blankObservation,
        } as never,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ type: 'navigate', url: 'https://example.com/' })

    const systemPrompt = String(chat.mock.calls[0]?.[0]?.[0]?.content)
    expect(systemPrompt).toContain('When the current page is about:blank')
    expect(systemPrompt).toContain('"const":"navigate"')
    expect(systemPrompt).toContain('"required":["observationId","pageId","type","url"]')
    expect(systemPrompt).toContain('"additionalProperties":false')
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
