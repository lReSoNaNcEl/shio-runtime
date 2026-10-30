import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '../../../src/main/llm'
import {
  CONTEXT_WINDOW_MESSAGES,
  ConversationContextWindow,
  SESSION_SUMMARY_MAX_CHARACTERS,
  type SessionSummarizer,
  sessionProse,
} from '../../../src/main/memory/ConversationContextWindow'
import { createLlmSessionSummarizer } from '../../../src/main/memory/SessionSummarizer'
import { desktopRoot } from '../../architecture/context'
import { createDeferred } from '../../support/Deferred'

const SESSION = 'default'

function turn(index: number, kind?: ChatMessage['assistantTurnKind']) {
  return {
    user: { role: 'user', content: `user ${index}` } as ChatMessage,
    assistant: {
      role: 'assistant',
      content: `assistant ${index}`,
      ...(kind ? { assistantTurnKind: kind } : {}),
    } as ChatMessage,
  }
}

async function fill(window: ConversationContextWindow, turns: number, start = 0) {
  for (let index = start; index < start + turns; index++)
    await window.appendTurn(SESSION, turn(index))
}

describe('conversation context window', () => {
  it('keeps the latest turns verbatim exactly like the previous truncation without a summarizer', async () => {
    const window = new ConversationContextWindow()
    await fill(window, 15)
    const history = await window.getHistory(SESSION)
    expect(history).toHaveLength(CONTEXT_WINDOW_MESSAGES)
    expect(history[0].content).toBe('user 5')
    expect(await window.getSessionSummary(SESSION)).toBeNull()
  })

  it('summarizes evicted prose in batches, single-flight, and folds later turns in', async () => {
    const calls: Array<{ previous: string | null; lines: number }> = []
    const gate = createDeferred<string>()
    const summarizer: SessionSummarizer = async (input) => {
      calls.push({ previous: input.previousSummary, lines: input.evicted.length })
      return calls.length === 1 ? gate.promise : `summary ${calls.length}`
    }
    const window = new ConversationContextWindow(() => summarizer)
    await fill(window, 12)
    expect(calls).toHaveLength(0)
    await fill(window, 1, 12)
    expect(calls).toEqual([{ previous: null, lines: 6 }])
    await fill(window, 4, 13)
    expect(calls).toHaveLength(1)
    gate.resolve('summary 1: the user is called Ann')
    await window.settle(SESSION)
    await window.settle(SESSION)
    expect(calls[1]).toEqual({ previous: 'summary 1: the user is called Ann', lines: 8 })
    expect(await window.getSessionSummary(SESSION)).toBe('summary 2')
  })

  it('keeps plain truncation and the previous summary when summarization fails', async () => {
    let fail = false
    const window = new ConversationContextWindow(() => async () => {
      if (fail) throw new Error('provider down')
      return 'first summary'
    })
    await fill(window, 13)
    await window.settle(SESSION)
    expect(await window.getSessionSummary(SESSION)).toBe('first summary')
    fail = true
    await fill(window, 3, 13)
    await window.settle(SESSION)
    expect(await window.getSessionSummary(SESSION)).toBe('first summary')
    expect(await window.getHistory(SESSION)).toHaveLength(CONTEXT_WINDOW_MESSAGES)
  })

  it('bounds the summary and excludes failure presentations and tool payloads', async () => {
    const seen: string[] = []
    const window = new ConversationContextWindow(() => async (input) => {
      seen.push(...input.evicted.map((line) => line.text))
      return 'x'.repeat(5_000)
    })
    for (let index = 0; index < 15; index++)
      await window.appendTurn(
        SESSION,
        turn(index, index % 2 === 0 ? 'provider-failure' : 'character'),
      )
    await window.settle(SESSION)
    expect(seen.some((text) => text.startsWith('assistant 0'))).toBe(false)
    expect(seen.some((text) => text.startsWith('assistant 1'))).toBe(true)
    expect((await window.getSessionSummary(SESSION))?.length).toBeLessThanOrEqual(
      SESSION_SUMMARY_MAX_CHARACTERS,
    )
    expect(
      sessionProse([
        { role: 'tool', content: 'raw tool payload', toolCallId: 'x' } as unknown as ChatMessage,
        { role: 'system', content: 'system' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]) },
          ],
        },
      ]),
    ).toEqual([{ role: 'user', text: 'look' }])
  })

  it('cancels an in-flight summary on clear and dispose and discards its late result', async () => {
    const signals: AbortSignal[] = []
    const gate = createDeferred<string>()
    const window = new ConversationContextWindow(() => async (_input, signal) => {
      signals.push(signal)
      return gate.promise
    })
    await fill(window, 13)
    await window.clear(SESSION)
    expect(signals[0].aborted).toBe(true)
    gate.resolve('late')
    await Promise.resolve()
    expect(await window.getSessionSummary(SESSION)).toBeNull()
    await fill(window, 13)
    window.dispose()
    window.dispose()
    expect(signals[1].aborted).toBe(true)
  })

  it('asks the summarizer role for a bounded, cancellable summary and strips protocol markers', async () => {
    const requests: Array<{ messages: readonly ChatMessage[]; signal?: AbortSignal }> = []
    const summarize = createLlmSessionSummarizer(() => ({
      chat: async (messages, options) => {
        requests.push({ messages, signal: options?.signal })
        return '[calm] Ann likes <shio-intent>x</shio-intent> cats.'
      },
    }))
    const controller = new AbortController()
    const summary = await summarize(
      { previousSummary: null, evicted: [{ role: 'user', text: 'I am Ann' }] },
      controller.signal,
    )
    expect(summary).toBe('Ann likes x cats.')
    expect(requests[0].signal).toBe(controller.signal)
    expect(String(requests[0].messages[1].content)).toContain('I am Ann')
  })

  it('never writes the window to SQLite or files', () => {
    for (const file of ['ConversationContextWindow.ts', 'SessionSummarizer.ts']) {
      const source = readFileSync(join(desktopRoot, 'src', 'main', 'memory', file), 'utf8')
      expect(source).not.toMatch(/node:fs|node:sqlite|better-sqlite|writeFile|DatabaseSync/u)
    }
  })
})
