import { describe, expect, it, vi } from 'vitest'

import { CharacterToolDispatcher } from '../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolRegistry } from '../../src/main/character-tools/CharacterToolRegistry'
import type { LLMProvider } from '../../src/main/llm/types'
import { InMemoryStore } from '../../src/main/memory/InMemoryStore'
import { Orchestrator } from '../../src/main/orchestrator'
import { WatchTogetherService } from '../../src/main/watch-together/WatchTogetherService'
import type { DesktopWorkflowRequest } from '../../src/shared/actions'
import type { ShioCapabilitySnapshot } from '../../src/shared/capabilities'
import type { AppSettings } from '../../src/shared/config'

const snapshot: ShioCapabilitySnapshot = {
  schemaVersion: 1,
  generatedAt: 1,
  capabilities: ['browser-control', 'computer-control'].map((id) => ({
    id,
    source: { kind: 'core' },
    category: 'action',
    titleKey: 'capabilities.browser.title',
    descriptionKey: 'capabilities.browser.description',
    availability: 'available',
  })),
}
const settings = { uiLocale: 'en', llm: { activeProvider: 'codex-cli' } } as AppSettings
const action = (authorization: 'confirmed' | 'full' = 'confirmed') =>
  vi.fn(async (_request: DesktopWorkflowRequest) => ({
    actionId: 'action-1-00000000-0000-4000-8000-000000000001',
    tool: 'desktop.workflow' as const,
    outcome: 'success' as const,
    authorization,
    execution: { runtimeCompleted: true, verification: 'verified' as const },
  }))

describe('explicit live-share tools', () => {
  it('keeps an interruption with a timed-out address check conversational even in Full Control', async () => {
    const text = 'Open https://example.com/'
    const classify = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValue(JSON.stringify({ disposition: 'addressed', summary: '' }))
    const watch = new WatchTogetherService({
      language: () => 'en',
      captureBlock: () => undefined,
      canComment: () => true,
      admit: async () => false,
      react: vi.fn(),
      ended: vi.fn(),
      model: () => ({ chat: classify }),
    })
    const session = watch.start('screen:1:0')
    if (session.kind !== 'started') throw new Error('Expected watch session')
    watch.takeGrant()
    try {
      expect(await watch.classifySpeech(session.id, text, true)).toBe('addressed')
      classify.mockRejectedValueOnce(new DOMException('Deadline exceeded', 'TimeoutError'))
      expect(await watch.classifySpeech(session.id, text, true)).toBeUndefined()
      await watch.prepareTurn(session.id, 'barge-in', true, undefined, 'private playback canary')
      const fallback = watch.takeUserTurn('barge-in', text)
      expect(fallback).toMatchObject({
        fromMicrophone: true,
        addressedVoice: false,
        directVoice: false,
      })

      const chat = vi
        .fn<LLMProvider['chat']>()
        .mockResolvedValueOnce('[calm]I haven’t opened the page. Did you want me to open it?')
      const execute = action('full')
      const capabilities = { snapshot: vi.fn(async () => snapshot) }
      const history = new InMemoryStore()
      const orchestrator = new Orchestrator(
        { chat },
        history,
        undefined,
        () => settings,
        undefined,
        capabilities,
        execute,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enforceRequirements: true },
      )
      const reply = await orchestrator.createReply({
        origin: 'watch-user',
        userText: text,
        watchContext: fallback,
      })
      expect(reply.replyText).toContain('haven’t opened')
      expect(chat).toHaveBeenCalledOnce()
      expect(capabilities.snapshot).not.toHaveBeenCalled()
      expect(execute).not.toHaveBeenCalled()
      expect(JSON.stringify(await history.getHistory('default'))).not.toContain(
        'private playback canary',
      )

      expect(await watch.classifySpeech(session.id, text, false)).toBe('addressed')
      await watch.prepareTurn(session.id, 'confirmed', true)
      const confirmed = watch.takeUserTurn('confirmed', text)
      expect(confirmed).toMatchObject({ addressedVoice: true, directVoice: false })
      chat
        .mockResolvedValueOnce(
          JSON.stringify({
            requirement: { type: 'explicit-tool', tool: 'browser.open' },
            plannedTools: ['browser.open'],
            embodiment: null,
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ url: 'https://example.com/' }))
        .mockResolvedValue('[calm]The page is open.')
      await orchestrator.createReply({
        origin: 'watch-user',
        userText: text,
        watchContext: confirmed,
      })
      expect(execute).toHaveBeenCalledOnce()
      await watch.prepareTurn(session.id, 'replayed', true)
      expect(watch.takeUserTurn('replayed', text)?.addressedVoice).toBe(false)

      const question = 'What is on my screen?'
      classify.mockResolvedValueOnce(
        JSON.stringify({
          disposition: 'addressed',
          summary: '',
          directPlan: { requirement: { type: 'direct-answer' }, plannedTools: [] },
        }),
      )
      expect(await watch.classifySpeech(session.id, question, false)).toBe('addressed')
      await watch.prepareTurn(session.id, 'short', true)
      const short = watch.takeUserTurn('short', question)
      expect(short).toMatchObject({ addressedVoice: true, directVoice: true })
      const callsBefore = chat.mock.calls.length
      const capabilitiesBefore = capabilities.snapshot.mock.calls.length
      chat.mockResolvedValueOnce('[calm]I see a chart.')
      const direct = await orchestrator.createReply({
        origin: 'watch-user',
        userText: question,
        watchContext: short,
      })
      expect(direct.replyText).toContain('I see a chart.')
      expect(chat.mock.calls.length).toBe(callsBefore + 1)
      expect(capabilities.snapshot.mock.calls.length).toBe(capabilitiesBefore)
      expect(execute).toHaveBeenCalledOnce()
    } finally {
      watch.stop(session.id)
    }
  })

  it.each([
    {
      tool: 'browser.open',
      args: { url: 'https://example.com/' },
      text: 'Open https://example.com/',
    },
    {
      tool: 'shell.execute',
      args: { command: 'Get-Date -Format yyyy' },
      text: 'Run Get-Date -Format yyyy',
    },
  ])(
    'plans $tool from the original user request and isolates all later tool arguments from capture',
    async ({ tool, args, text }) => {
      const chat = vi
        .fn<LLMProvider['chat']>()
        .mockResolvedValueOnce(
          JSON.stringify({
            requirement: { type: 'explicit-tool', tool },
            plannedTools: [tool],
            embodiment: null,
          }),
        )
        .mockResolvedValueOnce(JSON.stringify(args))
        .mockResolvedValue('[calm]Done.')
      const execute = action()
      const orchestrator = new Orchestrator(
        { chat },
        new InMemoryStore(),
        undefined,
        () => settings,
        undefined,
        { snapshot: async () => snapshot },
        execute,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enforceRequirements: true },
      )
      await orchestrator.createReply({
        userText: text,
        origin: 'watch-user',
        watchContext: {
          fromMicrophone: false,
          frame: new Uint8Array([9]),
          transcript: 'private audio canary',
          recentScenes: ['private screen canary'],
        },
      })
      expect(execute).toHaveBeenCalledOnce()
      const [request] = execute.mock.calls[0]
      if (tool === 'shell.execute') expect(request.shellCommand).toBe('Get-Date -Format yyyy')
      else
        expect(request.browserOperation).toEqual({ operation: 'open', url: 'https://example.com/' })
      for (const [messages] of chat.mock.calls) {
        const serialized = JSON.stringify(messages)
        expect(serialized).not.toContain('private audio canary')
        expect(serialized).not.toContain('private screen canary')
        expect(
          messages.some(
            (m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image'),
          ),
        ).toBe(false)
      }
    },
  )

  it('rejects unplanned typed, legacy, and mixed workflow calls even before the first tool result', async () => {
    const registry = new CharacterToolRegistry({
      projectAvailable: false,
      browserObservation: null,
      capabilityContext: snapshot,
      actionsAvailable: true,
    })
    const execute = action()
    const dispatcher = new CharacterToolDispatcher({
      registry: () => registry,
      userGoal: 'Open the reference',
      traceId: 'watch-test',
      signal: new AbortController().signal,
      plannedOnly: true,
      executeDesktopWorkflow: execute,
    })
    dispatcher.registerPlannedTools(['browser.open'])
    const request: DesktopWorkflowRequest = {
      type: 'desktop.workflow',
      risk: 'normal',
      goal: 'Check the year',
      requestedCapabilities: ['shell'],
      shellCommand: 'Get-Date -Format yyyy',
    }
    expect(
      JSON.parse(
        (await dispatcher.execute('shell.execute', { command: request.shellCommand })).content,
      ).ok,
    ).toBe(false)
    expect(JSON.parse((await dispatcher.executeLegacyAction(request)).content).ok).toBe(false)
    expect(
      JSON.parse(
        (
          await dispatcher.executeLegacyAction({
            ...request,
            requestedCapabilities: ['browser', 'shell'],
            browserOperation: { operation: 'open', url: 'https://example.com/' },
          })
        ).content,
      ).ok,
    ).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })
})
