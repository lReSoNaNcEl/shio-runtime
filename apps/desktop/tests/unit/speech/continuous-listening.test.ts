import { describe, expect, it } from 'vitest'

import { AttentionEngine } from '../../../src/renderer/conversation/admission/AttentionEngine'
import { RuleGate } from '../../../src/renderer/conversation/admission/RuleGate'
import {
  type BargeInObservation,
  BargeInPolicy,
} from '../../../src/renderer/speech/continuous-listening/BargeInPolicy'
import {
  ASR_STREAM_MAX_JSON_MESSAGE_CHARS,
  parseAsrStreamEvent,
} from '../../../src/renderer/speech/continuous-listening/StreamingAsrClient'
import {
  isExplicitBargeInPhrase,
  textSimilarity,
} from '../../../src/renderer/speech/continuous-listening/textAnalysis'
import { UtteranceChunkBuilder } from '../../../src/renderer/speech/continuous-listening/UtteranceChunkBuilder'
import { resolveContinuousAttention } from '../../../src/renderer/speech/conversation/ConversationInputCoordinator'

describe('continuous listening input policy', () => {
  it.each([
    ['{', 'ASR_PROTOCOL_INVALID_JSON'],
    [new ArrayBuffer(4), 'ASR_PROTOCOL_NON_TEXT'],
    ['x'.repeat(ASR_STREAM_MAX_JSON_MESSAGE_CHARS + 1), 'ASR_PROTOCOL_MESSAGE_TOO_LARGE'],
    [JSON.stringify({ type: 'ready', protocolVersion: 2 }), 'ASR_PROTOCOL_SCHEMA_INVALID'],
    [
      JSON.stringify({
        type: 'partial',
        sessionId: 's',
        segmentId: 'p',
        revision: 1,
        text: 'x'.repeat(16_001),
        startMs: 0,
        endMs: 1,
        confidence: 2,
      }),
      'ASR_PROTOCOL_SCHEMA_INVALID',
    ],
  ])('rejects invalid ASR input case %#', (input, code) => {
    expect(parseAsrStreamEvent(input)).toEqual({ ok: false, code })
  })

  it('accepts the supported ASR handshake', () => {
    expect(
      parseAsrStreamEvent(
        JSON.stringify({
          type: 'ready',
          protocolVersion: 1,
          sessionId: 'session',
          acceptedSampleRate: 16_000,
        }),
      ).ok,
    ).toBe(true)
  })

  const speaking: BargeInObservation = {
    now: 1000,
    activeResponseId: 'reply',
    responsePhase: 'playing',
    partialText: 'Шио, подожди',
    speechDurationMs: 340,
    confidence: 0.71,
    capturedDuringPlayback: true,
    playbackStartedAt: 500,
    responseInterruptionPending: false,
    likelySelfEcho: false,
  }
  it.each<[Partial<BargeInObservation>, string]>([
    [{ responsePhase: null }, 'not-speaking'],
    [{ speechDurationMs: 100 }, 'too-short'],
    [{ now: 700 }, 'grace-period'],
    [{ likelySelfEcho: true }, 'self-echo'],
    [{ confidence: 0.2 }, 'low-confidence'],
    [{ responseInterruptionPending: true }, 'interruption-pending'],
  ])('suppresses an interruption for %j', (patch, reason) => {
    expect(new BargeInPolicy().evaluate({ ...speaking, ...patch })).toEqual({
      type: 'ignore',
      reason,
    })
  })

  it('interrupts once per reply, observes cooldown and accepts a later synthesis correction', () => {
    const policy = new BargeInPolicy()
    expect(policy.evaluate(speaking).type).toBe('interrupt')
    policy.markTriggered('reply', speaking.now)
    expect(policy.evaluate({ ...speaking, now: 1100 })).toMatchObject({
      reason: 'already-triggered',
    })
    policy.settleResponse('reply')
    const next = { ...speaking, activeResponseId: 'next' }
    expect(policy.evaluate({ ...next, now: 1200 })).toMatchObject({ reason: 'retrigger-cooldown' })
    expect(
      policy.evaluate({
        ...next,
        now: 2100,
        responsePhase: 'synthesizing',
        capturedDuringPlayback: false,
        playbackStartedAt: null,
        partialText: 'Нет, я имел в виду другое',
      }).type,
    ).toBe('interrupt')
  })

  it.each([
    ['сегодня хорошая погода', 'Да, сегодня хорошая погода в Москве', 0.68],
    [
      'я думаю что',
      'Да, я думаю что этот вариант подойдёт лучше, если учитывать весь длинный ответ целиком',
      0.8,
    ],
  ])('recognizes playback overlap for %s', (heard, spoken, threshold) => {
    expect(textSimilarity(heard, spoken)).toBeGreaterThanOrEqual(threshold)
  })
  it.each(['Нет, я имел в виду другое', 'Шио, подожди'])(
    'recognizes the interruption %s',
    (text) => {
      expect(isExplicitBargeInPhrase(text)).toBe(true)
    },
  )

  it('deduplicates ASR finals, queues speech heard while busy and preserves local attention', () => {
    const builder = new UtteranceChunkBuilder({ now: () => 1000 })
    const metadata = {
      streamingSessionId: 'session',
      segmentId: 'segment',
      capturedDuringPlayback: false,
      triggeredBargeIn: true,
    }
    const first = builder.pushFinal('Шио, ты тут?', 0.9, metadata)
    expect(first).toMatchObject({ id: 'session:segment', triggeredBargeIn: true })
    expect(builder.pushFinal('Шио, ты тут?', 0.9, metadata)).toBeNull()
    if (!first) throw new Error('Expected an ASR final')
    const engine = new AttentionEngine()
    const context = {
      isSpeaking: true,
      cooldownActive: false,
      recentConversation: false,
      followUpWindow: false,
      curiosityChance: 0,
    }
    const attention = engine.evaluate(first, context)
    expect(attention.shouldAttend).toBe(true)
    expect(
      new RuleGate().decide(first, attention, {
        isSpeaking: true,
        conversationBusy: true,
        cooldownActive: false,
        alreadyHandled: false,
      }).type,
    ).toBe('backlog')
    const local = engine.evaluate(
      { ...first, text: 'Ты меня слышишь?' },
      { ...context, isSpeaking: false },
    )
    expect(local.shouldAttend).toBe(true)
    expect(
      resolveContinuousAttention(local, {
        shouldAttend: false,
        confidence: 0.62,
        source: 'deterministic',
        reason: 'deterministic_score',
        latencyMs: 0,
      }),
    ).toMatchObject({
      shouldAttend: true,
      score: local.score,
      reasons: expect.arrayContaining([expect.stringContaining('local_admit_preserved')]),
    })
  })
})
