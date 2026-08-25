import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

import {
  StreamingSpeechPipeline,
  type StreamingSpeechTimingEvent,
} from '../../src/renderer/runtime/StreamingSpeechPipeline'
import { StreamingSpeechSegmenter } from '../../src/shared/character-stream'
import type { EmotionTextSegment } from '../../src/shared/emotion'

type Metric =
  | 'llmTtft'
  | 'firstSentence'
  | 'ttsSegment'
  | 'firstAudio'
  | 'playbackStart'
  | 'fullTurn'
type Sample = Record<Metric, number>

const RU = [
  'Проверяю актуальную версию и скоро сообщу результат.',
  'Сейчас посмотрю официальный источник и вернусь с ответом.',
  'Да, я аккуратно сравню данные и ничего не буду менять.',
  'Минутку, сначала проверю факт, а затем отвечу.',
  'Готово, результат проверен и уже можно подвести итог.',
  'Я нашла нужную информацию и сверяю последнюю деталь.',
  'Начинаю безопасную проверку без изменений на компьютере.',
  'Сначала уточню версию, потом спокойно всё объясню.',
  'Проверка идёт, важные данные уже найдены.',
  'Сравню два источника и дам короткий точный ответ.',
]
const EN = [
  'I am checking the current version and will report back shortly.',
  'I will inspect the official source before giving you an answer.',
  'The safe read-only check is running and nothing will be changed.',
  'One moment, I am verifying the fact before I respond.',
  'The result is verified and ready for a concise summary.',
  'I found the relevant source and I am checking one final detail.',
  'Starting a safe comparison without modifying your computer.',
  'I will confirm the version first and explain the result clearly.',
  'The check is in progress and the important evidence is ready.',
  'I will compare both sources and give you a precise answer.',
]
const MIXED = Array.from(
  { length: 10 },
  (_, index) =>
    `Сначала проверю official release ${index + 1} и надёжность источника, затем сравню данные с локальной версией Node на компьютере. After that I will explain the difference, mention compatibility, and give a concise recommendation without changing the system.`,
)
const TEXTS = [...RU, ...EN, ...MIXED]

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function run(mode: 'before' | 'after', text: string, trace: number): Promise<Sample> {
  const started = Date.now()
  const llmTtft = 2 + (trace % 3)
  await wait(llmTtft)
  const segments = mode === 'after' ? currentSegments(text, trace) : legacySegments(text, trace)
  const firstSentence =
    llmTtft + Math.max(1, Math.ceil((segments[0]?.text.length ?? text.length) / 45))
  await wait(Math.max(1, firstSentence - llmTtft))
  const synthesisDurations: number[] = []
  let firstAudioAt = 0
  let playbackAt = 0

  if (mode === 'before') {
    for (const segment of segments) {
      const execution = synthDelay(segment)
      const synthStarted = performance.now()
      await wait(execution)
      synthesisDurations.push(performance.now() - synthStarted)
      await wait(2)
      if (firstAudioAt === 0) firstAudioAt = Date.now()
      if (playbackAt === 0) playbackAt = Date.now()
      await wait(playDelay(segment))
    }
  } else {
    const executionStarts = new Map<number, number>()
    const timing = (event: StreamingSpeechTimingEvent): void => {
      if (event.name === 'tts_execution_started') executionStarts.set(event.segment.index, event.at)
      if (event.name === 'tts_execution_completed')
        synthesisDurations.push(event.at - (executionStarts.get(event.segment.index) ?? event.at))
      if (event.name === 'audio_ready' && event.segment.index === 0) firstAudioAt = event.at
      if (event.name === 'playback_started' && event.segment.index === 0) playbackAt = event.at
    }
    const pipeline = new StreamingSpeechPipeline({
      turnId: `bench-${trace}`,
      synthesize: async (segment) => {
        await wait(synthDelay(segment))
        return { ok: true, audioBuffer: new ArrayBuffer(1), emotionKey: 'calm' } as never
      },
      prepareAudio: async () => {
        await wait(2)
        return { durationMs: 1 } as never
      },
      playPrepared: async (item, onStarted) => {
        onStarted()
        await wait(playDelay(item.segment))
      },
      isCurrentTurn: () => true,
      recordTiming: timing,
    })
    const task = pipeline.execute()
    for (const segment of segments) pipeline.enqueue(segment)
    pipeline.close()
    await task
  }

  const terminal = Date.now()
  return {
    llmTtft,
    firstSentence,
    ttsSegment: average(synthesisDurations),
    firstAudio: firstAudioAt - started,
    playbackStart: playbackAt - started,
    fullTurn: terminal - started,
  }
}

async function main(): Promise<void> {
  await run('before', MIXED[0], -1)
  await run('after', MIXED[0], -1)
  const before: Sample[] = []
  const after: Sample[] = []
  for (const [index, text] of TEXTS.entries()) before.push(await run('before', text, index))
  for (const [index, text] of TEXTS.entries()) after.push(await run('after', text, index))
  assert.equal(before.length, 30)
  assert.equal(after.length, 30)
  const report = {
    methodology:
      '30 warm deterministic local pipeline traces: 10 short RU, 10 short EN, 10 mixed long; simulated provider/audio delays; wall-clock orchestration measurement',
    before: summarize(before),
    after: summarize(after),
  }
  console.log(`LATENCY_BENCHMARK_JSON=${JSON.stringify(report)}`)
}

function currentSegments(text: string, trace: number): EmotionTextSegment[] {
  const segmenter = new StreamingSpeechSegmenter(`after-${trace}`)
  return [...segmenter.push({ emotion: 'calm', text }), ...segmenter.flush()].map(toEmotion)
}

function legacySegments(text: string, trace: number): EmotionTextSegment[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .filter(Boolean)
    .map((part, index) => ({
      id: `before-${trace}-${index}`,
      index,
      emotion: 'calm',
      text: part,
      boundaryAfter: 'sentence',
      targetMaxGapMs: 100,
    }))
}

function toEmotion(segment: {
  id: string
  sequence: number
  emotion: string
  text: string
}): EmotionTextSegment {
  return {
    id: segment.id,
    index: segment.sequence,
    emotion: segment.emotion,
    text: segment.text,
    boundaryAfter: 'sentence',
    targetMaxGapMs: 100,
  }
}

function synthDelay(segment: EmotionTextSegment): number {
  return 3 + Math.ceil(segment.text.length / 24)
}
function playDelay(segment: EmotionTextSegment): number {
  return 2 + Math.ceil(segment.text.length / 40)
}
function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}
function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}
function summarize(samples: readonly Sample[]): Record<Metric, { p50Ms: number; p95Ms: number }> {
  return Object.fromEntries(
    (
      ['llmTtft', 'firstSentence', 'ttsSegment', 'firstAudio', 'playbackStart', 'fullTurn'] as const
    ).map((metric) => [
      metric,
      {
        p50Ms: round(
          percentile(
            samples.map((item) => item[metric]),
            0.5,
          ),
        ),
        p95Ms: round(
          percentile(
            samples.map((item) => item[metric]),
            0.95,
          ),
        ),
      },
    ]),
  ) as Record<Metric, { p50Ms: number; p95Ms: number }>
}
function round(value: number): number {
  return Math.round(value * 10) / 10
}

void main()
