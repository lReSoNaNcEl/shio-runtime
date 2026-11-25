import assert from 'node:assert/strict'

import sharp from 'sharp'

import {
  CODEX_MODEL,
  codexCapabilities,
  createCodexCliProvider,
} from '../../src/main/llm/CodexCliProvider'
import type { LLMProvider } from '../../src/main/llm/types'
import { InMemoryStore } from '../../src/main/memory/InMemoryStore'
import { Orchestrator } from '../../src/main/orchestrator'
import { WatchTogetherService } from '../../src/main/watch-together/WatchTogetherService'
import type { AppSettings } from '../../src/shared/config'

// Both paths classify the same final ASR transcript and answer from the same synthetic frame.
// The control discards only the fused direct plan, forcing the normal additional planning call.
async function qualify() {
  const native = createCodexCliProvider(CODEX_MODEL, codexCapabilities(CODEX_MODEL), 'low')
  let calls = 0
  const model: LLMProvider = {
    ...native,
    chat: (...args) => {
      calls++
      return native.chat(...args)
    },
  }
  const settings = { uiLocale: 'ru', llm: { activeProvider: 'codex-cli' } } as AppSettings
  const watch = new WatchTogetherService({
    language: () => 'ru',
    captureBlock: () => undefined,
    canComment: () => true,
    model: () => model,
    admit: async () => false,
    react: () => {},
    ended: () => {},
  })
  const frame = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="432"><rect width="768" height="432" fill="white"/><circle cx="384" cy="216" r="130" fill="blue"/></svg>',
    ),
  )
    .jpeg()
    .toBuffer()
  const utterance = 'Шио, какого цвета фигура в центре экрана? Одним словом.'
  const rows: { path: string; calls: number; ms: number }[] = []
  for (const fused of [false, true, true, false, false, true]) {
    const orchestrator = new Orchestrator(
      model,
      new InMemoryStore(),
      undefined,
      () => settings,
      undefined,
      undefined,
      undefined,
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
    const session = watch.start('window:synthetic')
    assert.equal(session.kind, 'started')
    assert(watch.takeGrant())
    calls = 0
    const start = performance.now()
    try {
      assert.equal(await watch.classifySpeech(session.id, utterance, false), 'addressed')
      await watch.prepareTurn(session.id, 'sample', true, Uint8Array.from(frame).buffer)
      const context = watch.takeUserTurn('sample', utterance)
      assert(context?.directVoice, 'classifier did not select a direct visual answer')
      const reply = await orchestrator.createReply({
        userText: utterance,
        origin: 'watch-user',
        watchContext: { ...context, directVoice: fused },
      })
      assert.match(reply.replyText, /син|голуб/iu)
      rows.push({
        path: fused ? 'fused' : 'separate',
        calls,
        ms: Math.round(performance.now() - start),
      })
      console.log(JSON.stringify(rows.at(-1)))
    } finally {
      watch.stop(session.id)
    }
  }
  const median = (path: string) =>
    rows
      .filter((row) => row.path === path)
      .map((row) => row.ms)
      .sort((a, b) => a - b)[1]
  console.log(
    JSON.stringify({
      provider: 'codex-cli',
      model: CODEX_MODEL,
      effort: 'low',
      medianMs: { separate: median('separate'), fused: median('fused') },
    }),
  )
}

void qualify().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
