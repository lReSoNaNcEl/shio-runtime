import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import { PERSONA_PROMPT_SECTIONS } from '../../src/main/character/prompting/persona.generated'
import type { LLMProvider } from '../../src/main/llm/types'
import { InMemoryStore } from '../../src/main/memory/InMemoryStore'
import { Orchestrator } from '../../src/main/orchestrator'
import { WatchTogetherService } from '../../src/main/watch-together/WatchTogetherService'
import type { AppSettings } from '../../src/shared/config'
import type { WatchBlockReason } from '../../src/shared/watchTogether'

function dependencies(chat: LLMProvider['chat']) {
  return {
    language: () => 'ru',
    captureBlock: vi.fn<() => WatchBlockReason | undefined>(() => undefined),
    canComment: vi.fn(() => true),
    model: () => ({ chat }),
    admit: vi.fn(async (_at: number, current: () => boolean) => current()),
    ended: vi.fn(),
  }
}

async function fixture(chat: LLMProvider['chat']) {
  const deps = dependencies(chat)
  const watch = new WatchTogetherService(deps)
  const result = watch.start('window:1:0')
  if (result.kind !== 'started') throw new Error('Expected a watch session')
  const { id } = result
  const jpeg = await sharp({ create: { width: 960, height: 270, channels: 3, background: 'blue' } })
    .jpeg()
    .toBuffer()
  const input = {
    sessionId: id,
    endedAt: Date.now(),
    frames: Uint8Array.from(jpeg).buffer,
    pcm: new Int16Array(32000).fill(2000).buffer,
    playbackTranscript: 'The bridge is solid.',
  }
  return { watch, id, deps, input }
}
describe('Watch Together', () => {
  it('binds source speech to the user turn during cooldown and remembers their take within this session', async () => {
    const chat = vi.fn<LLMProvider['chat']>(async () => '{"observation":"bridge fell","line":""}')
    const { watch, deps, id, input } = await fixture(chat)
    watch.takeGrant()
    deps.canComment.mockReturnValue(false)
    await watch.prepareTurn(id, 'voice', true, undefined, 'The bridge is solid.')
    expect(watch.takeUserTurn('voice', 'So much for that bridge!')?.transcript).toBe(
      'The bridge is solid.',
    )
    expect(watch.takeUserTurn('voice')).toBeUndefined()
    deps.canComment.mockReturnValue(true)
    await watch.observe(input)
    expect(JSON.stringify(chat.mock.calls[0][0])).toContain('So much for that bridge!')
    await watch.prepareTurn(id, 'question', false)
    expect(watch.takeUserTurn('question')?.recentScenes).toEqual(['bridge fell'])
    watch.stop(id)
    const next = watch.start('screen:2:0')
    if (next.kind !== 'started') throw new Error('Expected next session')
    watch.takeGrant()
    await watch.prepareTurn(next.id, 'new', false)
    expect(watch.takeUserTurn('new')?.recentScenes).toEqual([])
    await watch.observe({ ...input, sessionId: next.id, endedAt: Date.now() })
    expect(JSON.stringify(chat.mock.calls[1][0])).not.toContain('So much for that bridge!')
  })

  it('grounds the user reply in the shared frame without consulting browser tools', async () => {
    const frame = new Uint8Array([1, 2, 3])
    const history = new InMemoryStore()
    const chat = vi.fn<LLMProvider['chat']>(async () => 'Вижу мост и синий шар.')
    const browser = vi.fn()
    const orchestrator = new Orchestrator(
      { chat },
      history,
      undefined,
      () => ({ uiLocale: 'ru' }) as AppSettings,
      undefined,
      undefined,
      undefined,
      browser,
    )
    const userText = 'Что сейчас на трансляции?'
    const result = await orchestrator.createReply({
      userText,
      origin: 'watch-user',
      watchContext: { frame, fromMicrophone: true },
    })
    expect(result.replyText).toBe('Вижу мост и синий шар.')
    expect(browser).not.toHaveBeenCalled()
    expect(chat.mock.calls[0][0].at(-1)?.content).toEqual([
      { type: 'text', text: JSON.stringify({ userRequest: userText, inputFromMicrophone: true }) },
      { type: 'image', mimeType: 'image/jpeg', bytes: frame },
    ])
    expect((await history.getHistory('default'))[0].content).toBe(userText)
  })

  it.each(['suspended', 'off'] as const)(
    'reports the %s block without creating a capture grant',
    (reason) => {
      const chat = vi.fn()
      const deps = dependencies(chat)
      deps.captureBlock.mockReturnValue(reason)
      const watch = new WatchTogetherService(deps)
      expect(watch.start('window:1:0')).toEqual({ kind: 'blocked', reason })
      expect(watch.takeGrant()).toBeUndefined()
      expect(chat).not.toHaveBeenCalled()
    },
  )

  it('shares the policy reason when revoking an active session', async () => {
    const { watch, deps, id, input } = await fixture(vi.fn())
    watch.takeGrant()
    deps.captureBlock.mockReturnValue('suspended')
    expect(await watch.observe(input)).toEqual({ kind: 'stopped' })
    watch.stop(undefined, 'suspended')
    expect(deps.ended).toHaveBeenCalledExactlyOnceWith({ id, reason: 'suspended' })
    expect(deps.admit).not.toHaveBeenCalled()
  })

  it('leases a valid current frame to one exact user turn and revokes it on stop', async () => {
    const { watch, id } = await fixture(vi.fn())
    const frame = await sharp({
      create: { width: 768, height: 432, channels: 3, background: 'blue' },
    })
      .jpeg()
      .toBuffer()
    await watch.prepareTurn(id, 'before-capture', true, Uint8Array.from(frame).buffer)
    expect(watch.takeUserTurn('before-capture')).toBeUndefined()
    watch.takeGrant()
    await watch.prepareTurn(id, 'user-1', true, Uint8Array.from(frame).buffer)
    expect(watch.takeUserTurn('user-2')).toBeUndefined()
    const context = watch.takeUserTurn('user-1')
    expect(context?.frame).toEqual(frame)
    expect(context?.fromMicrophone).toBe(true)
    expect(watch.takeUserTurn('user-1')).toBeUndefined()
    watch.stop(id)
    expect(context?.signal.aborted).toBe(true)
  })

  it('requires a one-use capture grant and policy approval before sampling, then admits a model-selected moment', async () => {
    const line = 'Ебать, мост сложился.'
    const chat = vi.fn<LLMProvider['chat']>(async () =>
      JSON.stringify({ observation: 'bridge fell', line }),
    )
    const { watch, input, id, deps } = await fixture(chat)
    expect(await watch.observe(input)).toEqual({ kind: 'stopped' })
    expect(watch.takeGrant()).toEqual({ id, sourceId: 'window:1:0' })
    expect(watch.takeGrant()).toBeUndefined()
    deps.canComment.mockReturnValueOnce(false)
    expect(await watch.observe(input)).toEqual({ kind: 'quiet' })
    expect(chat).not.toHaveBeenCalled()
    const choice = await watch.observe(input)
    expect(chat.mock.calls[0][0][0].content).toContain(
      PERSONA_PROMPT_SECTIONS.personality.join('\n'),
    )
    expect(choice.kind).toBe('comment')
    if (choice.kind !== 'comment') throw new Error('Expected admitted commentary')
    expect(watch.takeReply('another-turn')).toBeUndefined()
    expect(watch.takeReply(choice.turnId)).toBe(line)
    expect(watch.takeReply(choice.turnId)).toBeUndefined()
    expect(deps.admit).toHaveBeenCalledOnce()
    watch.stop(id)
    expect(await watch.observe(input)).toEqual({ kind: 'stopped' })
  })
  it('lets the model stay silent and discards expired packets before inference', async () => {
    const { watch, deps, input } = await fixture(
      async () => '{"observation":"same shot","line":""}',
    )
    watch.takeGrant()
    expect(await watch.observe({ ...input, endedAt: Date.now() - 40000 })).toEqual({
      kind: 'quiet',
    })
    expect(deps.admit).not.toHaveBeenCalled()
    expect(await watch.observe(input)).toEqual({ kind: 'quiet' })
    expect(deps.admit).not.toHaveBeenCalled()
  })
  it.each(['yield', 'stop'] as const)(
    'aborts in-flight inference and drops even an uncancellable late result on %s',
    async (action) => {
      let started!: () => void, finish!: (s: string) => void
      const ready = new Promise<void>((resolve) => {
        started = resolve
      })
      let signal: AbortSignal | undefined
      const { watch, deps, id, input } = await fixture(async (_messages, opts) => {
        signal = opts?.signal
        started()
        return new Promise<string>((resolve) => {
          finish = resolve
        })
      })
      watch.takeGrant()
      const result = watch.observe(input)
      await ready
      watch[action](id)
      expect(signal?.aborted).toBe(true)
      finish('{"observation":"late","comment":true}')
      expect(await result).toEqual({ kind: 'quiet' })
      expect(deps.admit).not.toHaveBeenCalled()
    },
  )
})
