import { afterEach, describe, expect, it, vi } from 'vitest'

import { OllamaStreamWarmup } from '../../../src/main/llm/OllamaStreamWarmup'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Ollama while recording', () => {
  it('prepares once, renews while sharing and releases by expiry without evicting other clients', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => Response.json({ done: true }))
    vi.stubGlobal('fetch', request)
    const warmup = new OllamaStreamWarmup(() => 'gemma4:e4b')
    const session = new AbortController()
    expect(await Promise.all([warmup.prepare(), warmup.prepare()])).toEqual([true, true])
    warmup.retain(session.signal)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/generate',
      expect.objectContaining({
        body: JSON.stringify({ model: 'gemma4:e4b', stream: false, keep_alive: '5m' }),
      }),
    )
    await vi.advanceTimersByTimeAsync(12 * 60_000)
    expect(request).toHaveBeenCalledTimes(13)
    session.abort()
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    expect(request).toHaveBeenCalledTimes(13)
    warmup.dispose()
  })

  it('retries after an unavailable runner and follows the selected model', async () => {
    vi.useFakeTimers()
    let selected: string | undefined
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.error())
      .mockImplementation(async () => Response.json({ done: true }))
    vi.stubGlobal('fetch', request)
    const warmup = new OllamaStreamWarmup(() => selected)
    expect(await warmup.prepare()).toBe(true)
    expect(request).not.toHaveBeenCalled()
    selected = 'gemma4:e4b'
    expect(await warmup.prepare()).toBe(false)
    expect(await warmup.prepare()).toBe(true)
    selected = 'gemma4:12b'
    expect(await warmup.prepare()).toBe(true)
    expect(request).toHaveBeenCalledTimes(3)
    warmup.dispose()
  })
})
