// Deterministic streaming-latency benchmark; not a correctness test.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

import { SpeechTextCommitBuffer } from '../../src/shared/character-stream'

interface Sample {
  firstCommitMs: number
  firstPcmMs: number
  playbackStartMs: number
  fullTurnMs: number
}

const TEXTS = [
  'Проверяю актуальную версию и скоро сообщу результат.',
  'Сейчас посмотрю официальный источник и вернусь с ответом.',
  'I will inspect the official source before giving you an answer.',
  'The safe read-only check is running and nothing will be changed.',
  'Сначала проверю official release и затем объясню compatibility без изменения системы.',
]

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

async function run(text: string, trace: number): Promise<Sample> {
  const started = performance.now()
  const buffer = new SpeechTextCommitBuffer(`benchmark-${trace}`)
  const midpoint = Math.ceil(text.length / 2)
  await wait(2 + (trace % 2))
  let commits = [...buffer.push({ emotion: 'calm', text: text.slice(0, midpoint) })]
  await wait(2)
  commits = [
    ...commits,
    ...buffer.push({ emotion: 'calm', text: text.slice(midpoint) }),
    ...buffer.flush(),
  ]
  assert.ok(commits.length > 0)
  const firstCommitMs = performance.now() - started
  await wait(3 + Math.ceil(commits[0].text.length / 30))
  const firstPcmMs = performance.now() - started
  await wait(1)
  const playbackStartMs = performance.now() - started
  await wait(Math.max(1, Math.ceil(text.length / 40)))
  return {
    firstCommitMs,
    firstPcmMs,
    playbackStartMs,
    fullTurnMs: performance.now() - started,
  }
}

async function main(): Promise<void> {
  const samples: Sample[] = []
  for (const [index, text] of TEXTS.entries()) samples.push(await run(text, index))
  console.log(
    `STREAMING_LATENCY_BENCHMARK_JSON=${JSON.stringify({
      methodology: 'five deterministic text-in/PCM-out traces with simulated provider delays',
      samples: samples.length,
      metrics: summarize(samples),
    })}`,
  )
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

function summarize(
  samples: readonly Sample[],
): Record<keyof Sample, { p50Ms: number; p95Ms: number }> {
  return Object.fromEntries(
    (['firstCommitMs', 'firstPcmMs', 'playbackStartMs', 'fullTurnMs'] as const).map((metric) => [
      metric,
      {
        p50Ms:
          Math.round(
            percentile(
              samples.map((sample) => sample[metric]),
              0.5,
            ) * 10,
          ) / 10,
        p95Ms:
          Math.round(
            percentile(
              samples.map((sample) => sample[metric]),
              0.95,
            ) * 10,
          ) / 10,
      },
    ]),
  ) as Record<keyof Sample, { p50Ms: number; p95Ms: number }>
}

void main()
