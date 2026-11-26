import { describe, expect, it, vi } from 'vitest'

import type { LLMProvider } from '../../src/main/llm/types'
import {
  PreparedWatchVoiceReply,
  type WatchVoiceReplyInput,
} from '../../src/main/watch-together/PreparedWatchVoiceReply'
import { WatchTogetherService } from '../../src/main/watch-together/WatchTogetherService'

function setup() {
  const gate = Promise.withResolvers<string>()
  const classify = vi.fn<LLMProvider['chat']>().mockReturnValue(gate.promise)
  const generate = vi.fn<LLMProvider['chat']>().mockResolvedValue('A blue rectangle.')
  const prepare = vi.fn(
    (input: WatchVoiceReplyInput, signal: AbortSignal) =>
      new PreparedWatchVoiceReply(
        input,
        signal,
        {},
        () => 'luna-low',
        async () => [],
        { chat: generate },
        'codex-cli',
      ),
  )
  const watch = new WatchTogetherService({
    language: () => 'en',
    captureBlock: () => undefined,
    canComment: () => true,
    model: () => ({ chat: classify }),
    prepareVoiceReply: prepare,
    admit: async () => false,
    react: vi.fn(),
    ended: vi.fn(),
  })
  const session = watch.start('screen:1:0')
  if (session.kind !== 'started') throw new Error('Expected watch session')
  watch.takeGrant()
  const text = 'What is on my screen?'
  const sample = { utteranceId: 'live-1', playbackTranscript: 'selected source' }
  const classifyTurn = () => watch.classifySpeech(session.id, text, false, sample)
  const takeTurn = () => watch.takeUserTurn(sample.utteranceId, text)
  const decide = (disposition: string) => gate.resolve(JSON.stringify({ disposition, summary: '' }))
  return { watch, session, classify, prepare, generate, classifyTurn, takeTurn, decide }
}

describe('parallel microphone admission during screen sharing', () => {
  it.each(['direct-answer', 'addressed', 'aside', 'ignore'])(
    'only releases the matching direct draft for %s',
    async (decision) => {
      const t = setup()
      try {
        const work = t.classifyTurn()
        await vi.waitFor(() => expect(t.generate).toHaveBeenCalledOnce())
        expect(t.classify).toHaveBeenCalledOnce()
        expect(t.takeTurn()).toBeUndefined()
        t.decide(decision)
        expect(await work).toBe(decision === 'direct-answer' ? 'addressed' : decision)
        const turn = t.takeTurn()
        if (decision === 'aside' || decision === 'ignore') expect(turn).toBeUndefined()
        else {
          expect(turn).toMatchObject({
            addressedVoice: true,
            directVoice: decision === 'direct-answer',
            transcript: 'selected source',
          })
          if (decision === 'direct-answer') {
            expect(turn?.preparedReply).toBe(t.prepare.mock.results[0].value)
            turn?.preparedReply?.discard()
          } else expect(turn?.preparedReply).toBeUndefined()
        }
        if (decision !== 'direct-answer')
          expect(t.generate.mock.calls[0][1]?.signal?.aborted).toBe(true)
        expect(t.takeTurn()).toBeUndefined()
      } finally {
        t.watch.stop()
      }
    },
  )

  it.each(['speech', 'stop'] as const)(
    'cancels both requests on %s and ignores a late verdict',
    async (cause) => {
      const t = setup()
      try {
        const work = t.classifyTurn()
        await vi.waitFor(() => expect(t.generate).toHaveBeenCalledOnce())
        if (cause === 'speech') t.watch.yield(t.session.id, 'speech')
        else t.watch.stop()
        expect(t.generate.mock.calls[0][1]?.signal?.aborted).toBe(true)
        expect(t.classify.mock.calls[0][1]?.signal?.aborted).toBe(true)
        t.decide('direct-answer')
        expect(await work).toBe('ignore')
        expect(t.takeTurn()).toBeUndefined()
      } finally {
        t.watch.stop()
      }
    },
  )
})
