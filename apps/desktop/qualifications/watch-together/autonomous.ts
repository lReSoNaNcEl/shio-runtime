import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'

import sharp from 'sharp'

import {
  CODEX_MODEL,
  codexCapabilities,
  createCodexCliProvider,
} from '../../src/main/llm/CodexCliProvider'
import type { LLMProvider } from '../../src/main/llm/types'
import { WatchTogetherService } from '../../src/main/watch-together/WatchTogetherService'
import {
  WATCH_FRAME_HEIGHT,
  WATCH_FRAME_WIDTH,
  type WatchReaction,
} from '../../src/shared/watchTogether'

function terminal(passed: boolean) {
  const title = passed ? 'BUILD PASSED' : 'BUILD FAILED'
  const color = passed ? '#80e9a1' : '#ff827a'
  const result = passed ? '149 passed, 0 failed' : '148 passed, 1 failed'
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WATCH_FRAME_WIDTH}" height="${WATCH_FRAME_HEIGHT}">
    <rect width="100%" height="100%" fill="#171c24"/>
    <g font-family="Consolas, monospace" fill="#d9e3ef">
    <text x="34" y="52" font-size="24">Terminal - CI / desktop</text>
    <text x="34" y="117" font-size="28">$ npm run build</text>
    <text x="34" y="172" font-size="22">run #${passed ? '4' : '3'} / validate release</text>
    <text x="34" y="232" font-size="27">tests: ${result}</text>
    <text x="34" y="330" fill="${color}" font-size="55" font-weight="bold">${title}</text>
    <text x="34" y="385" font-size="23">exit code ${passed ? 0 : 1}</text></g></svg>`)
}

async function pair(before: boolean, after: boolean) {
  const jpg = await sharp({
    create: {
      width: WATCH_FRAME_WIDTH * 2,
      height: WATCH_FRAME_HEIGHT,
      channels: 3,
      background: '#171c24',
    },
  })
    .composite([
      { input: terminal(before), left: 0, top: 0 },
      { input: terminal(after), left: WATCH_FRAME_WIDTH, top: 0 },
    ])
    .jpeg()
    .toBuffer()
  return Uint8Array.from(jpg).buffer
}

async function qualify() {
  const native = createCodexCliProvider(CODEX_MODEL, codexCapabilities(CODEX_MODEL), 'low')
  const reactions: WatchReaction[] = []
  const outputs: {
    reaction: string
    observation: string
    evidenceIds: string[]
    priorObservations: number
    backgroundRemarks: number
  }[] = []
  let step = ''
  const model: LLMProvider = {
    ...native,
    async chat(...args) {
      const now = performance.now()
      const answer = await native.chat(...args)
      const parsed = JSON.parse(
        answer.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/giu, ''),
      )
      if (typeof parsed.reaction === 'string') {
        const content = args[0].at(-1)?.content
        assert(Array.isArray(content), 'Vision request lacks multimodal context')
        const note = content.find((part) => part.type === 'text')
        assert(note?.type === 'text')
        const context = JSON.parse(note.text)
        outputs.push({
          reaction: parsed.reaction,
          evidenceIds: parsed.evidenceIds,
          observation: parsed.observation,
          priorObservations: context.recent.length,
          backgroundRemarks: context.remarks.length,
        })
      }
      console.log(
        JSON.stringify({
          step,
          modelMs: Math.round(performance.now() - now),
          choice: parsed.reaction ?? parsed.disposition,
        }),
      )
      return answer
    },
  }
  const watch = new WatchTogetherService({
    language: () => 'ru',
    captureBlock: () => undefined,
    canComment: () => true,
    model: () => model,
    admit: async (_expiresAt, current) => current(),
    react: (_id, reaction) => reactions.push(reaction),
    ended: () => {},
  })
  const session = watch.start('window:synthetic-terminal')
  assert.equal(session.kind, 'started')
  const { id } = session
  assert(watch.takeGrant())
  let priorStart = 0
  async function observe(label: string, before: boolean, after: boolean) {
    step = label
    const frames = await pair(before, after)
    await pause(Math.max(0, priorStart + 4400 - Date.now()))
    const imagesBefore = outputs.length
    const reactionsBefore = reactions.length
    priorStart = Date.now()
    const decision = await watch.observe({
      sessionId: id,
      endedAt: priorStart,
      frames,
      pcm: new ArrayBuffer(0),
      playbackTranscript: '',
    })
    let reply: ReturnType<WatchTogetherService['takeReply']>
    if (decision.kind === 'comment') {
      reply = watch.takeReply(decision.turnId)
      assert(reply, 'Expired or empty comment')
      watch.finishComment(id, decision.turnId, true)
    }
    const result = {
      step,
      presented:
        typeof reply === 'object' ? reply.vocal : (reactions[reactionsBefore] ?? decision.kind),
      elapsedMs: Date.now() - priorStart,
      modelReported: outputs.slice(imagesBefore),
      line: typeof reply === 'string' ? reply : undefined,
    }
    console.log(JSON.stringify(result))
    return result
  }
  try {
    console.log(
      JSON.stringify({
        provider: 'codex-cli',
        model: CODEX_MODEL,
        effort: 'low',
        scene: 'synthetic terminal',
        admission: 'available fixture',
      }),
    )
    const setup = await observe('failed build', false, false)
    const routine = await observe('unchanged failure', false, false)
    step = 'thinking aloud'
    const aside = await watch.classifySpeech(
      id,
      'Ну всё, последняя попытка. Если опять упадёт, иду спать.',
      false,
    )
    const payoff = await observe('build recovered', false, true)
    const settled = await observe('unchanged success', true, true)
    assert.equal(setup.presented, 'quiet')
    assert.equal(routine.presented, 'quiet')
    assert.equal(aside, 'aside')
    assert.equal(settled.presented, 'quiet')
    assert.equal(setup.modelReported.length, 1, 'No completed baseline observation')
    assert.equal(payoff.modelReported.length, 1, 'No completed payoff observation')
    assert(payoff.modelReported[0]?.priorObservations, 'Build recovery lost its previous attempts')
    assert(payoff.modelReported[0]?.backgroundRemarks, 'Build recovery lost the background remark')
    assert.equal(routine.modelReported.length, 0, 'Unchanged failure reached the provider')
    assert.equal(settled.modelReported.length, 0, 'Unchanged success reached the provider')
    assert.notEqual(payoff.presented, 'unavailable')
  } finally {
    watch.stop(id)
  }
}
void qualify().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
