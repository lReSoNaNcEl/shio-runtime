import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { SpeechApplicationService } from '../../../src/main/app/SpeechApplicationService'
import { StreamingSpeechPipeline } from '../../../src/renderer/runtime/StreamingSpeechPipeline'
import { StreamingSpeechSegmenter } from '../../../src/shared/character-stream'
import type { EmotionTextSegment } from '../../../src/shared/emotion'
import { LatencyTelemetry } from '../../../src/shared/latency'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function orderedTwoWorkerPipeline(): Promise<void> {
  const resolvers = new Map<number, () => void>()
  const started: number[] = []
  const played: number[] = []
  let active = 0
  let maximumActive = 0
  const pipeline = new StreamingSpeechPipeline({
    turnId: 'parallel-turn',
    synthesize: async (segment) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      started.push(segment.index)
      await new Promise<void>((resolve) => resolvers.set(segment.index, resolve))
      active -= 1
      return { ok: true, audioBuffer: new ArrayBuffer(1), emotionKey: segment.emotion } as never
    },
    prepareAudio: async () => ({ durationMs: 1 }) as never,
    playPrepared: async (item, onStarted) => {
      onStarted()
      played.push(item.segment.index)
    },
    isCurrentTurn: () => true,
  })
  const execution = pipeline.execute()
  for (let index = 0; index < 3; index += 1) pipeline.enqueue(segment(index))
  pipeline.close()
  await tick()
  assert.deepEqual(started, [0, 1])
  assert.equal(maximumActive, 2)
  resolvers.get(1)?.()
  await tick()
  assert.deepEqual(played, [], 'Segment 2 played before segment 1 was ready')
  resolvers.get(0)?.()
  await tick()
  await tick()
  assert.ok(started.includes(2), 'Third segment did not leave the bounded queue')
  resolvers.get(2)?.()
  await execution
  assert.deepEqual(played, [0, 1, 2])
}

async function cancellationAbortsBothWorkers(): Promise<void> {
  let aborted = 0
  const pipeline = new StreamingSpeechPipeline({
    turnId: 'cancel-turn',
    synthesize: (_segment, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted += 1
            reject(signal.reason)
          },
          { once: true },
        )
      }),
    prepareAudio: async () => ({ durationMs: 1 }) as never,
    playPrepared: async () => undefined,
    isCurrentTurn: () => true,
  })
  const execution = pipeline.execute()
  pipeline.enqueue(segment(0))
  pipeline.enqueue(segment(1))
  await tick()
  pipeline.cancel()
  pipeline.close()
  await assert.rejects(execution, /cancelled/u)
  assert.equal(aborted, 2)
}

async function mainServiceAllowsExactlyTwo(): Promise<void> {
  const releases: Array<() => void> = []
  let active = 0
  let maximum = 0
  const service = new SpeechApplicationService(
    () => ({}) as never,
    () =>
      ({
        synthesizeReply: async (_text: string, _emotion: string, signal: AbortSignal) => {
          active += 1
          maximum = Math.max(maximum, active)
          await new Promise<void>((resolve, reject) => {
            releases.push(resolve)
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
          active -= 1
          return { audioBuffer: new ArrayBuffer(1), emotionKey: 'calm' }
        },
      }) as never,
  )
  const first = service.synthesize('turn', 'one', 'calm')
  const second = service.synthesize('turn', 'two', 'calm')
  await tick()
  await assert.rejects(service.synthesize('turn', 'three', 'calm'), /worker limit/u)
  assert.equal(maximum, 2)
  for (const release of releases.splice(0)) release()
  await Promise.all([first, second])
  await service.dispose()
}

function firstSegmentBoundaries(): void {
  const segmenter = new StreamingSpeechSegmenter('first-segment')
  const text =
    'Сначала коротко проверю актуальную версию и официальные источники, затем спокойно сравню её с установленной версией на компьютере и подведу итог.'
  const segments = [...segmenter.push({ emotion: 'calm', text }), ...segmenter.flush()]
  assert.ok(segments.length >= 2)
  assert.ok(segments[0]?.text.length >= 60 && segments[0].text.length <= 140)

  const urlSegmenter = new StreamingSpeechSegmenter('url-safe')
  const urlText =
    'Проверю официальный источник https://nodejs.org/download/release/latest/ прежде чем продолжить сравнение установленной версии.'
  const urlSegments = [
    ...urlSegmenter.push({ emotion: 'calm', text: urlText }),
    ...urlSegmenter.flush(),
  ]
  assert.ok(
    urlSegments.some((item) => item.text.includes('https://nodejs.org/download/release/latest/')),
  )
}

function detailedLatencyTelemetry(): void {
  const telemetry = new LatencyTelemetry()
  const correlation = {
    turnId: 'latency-turn',
    requestId: 'latency-request',
    llmRound: 0,
    ttsSegmentId: 'segment-0',
  }
  const record = (
    name:
      | 'input_received'
      | 'tts_queue_entered'
      | 'tts_execution_started'
      | 'tts_execution_completed'
      | 'audio_preparation_started'
      | 'audio_preparation_completed'
      | 'audio_ready'
      | 'playback_started'
      | 'turn_terminal',
    at: number,
  ): void => telemetry.record({ name, at, correlation, metadata: { workerId: 'worker-0' } })
  record('input_received', 1_000)
  record('tts_queue_entered', 1_010)
  record('tts_execution_started', 1_020)
  record('tts_execution_completed', 1_050)
  record('audio_preparation_started', 1_050)
  record('audio_preparation_completed', 1_060)
  record('audio_ready', 1_060)
  record('playback_started', 1_070)
  record('turn_terminal', 1_100)
  const snapshot = telemetry.snapshot()
  assert.equal(snapshot.metrics.ttsQueueWait?.p50Ms, 10)
  assert.equal(snapshot.metrics.ttsExecution?.p50Ms, 30)
  assert.equal(snapshot.metrics.audioPreparation?.p50Ms, 10)
  assert.equal(snapshot.metrics.audioReadyToPlaybackStart?.p50Ms, 10)
  assert.equal(snapshot.recentTraces[0]?.milestones[1]?.metadata?.workerId, 'worker-0')
}

function segment(index: number): EmotionTextSegment {
  return {
    id: `segment-${index}`,
    index,
    emotion: 'calm',
    text: `segment ${index}`,
    boundaryAfter: 'sentence',
    targetMaxGapMs: 100,
  }
}

describe('Streaming TTS integration', () => {
  it('uses two synthesis workers while preserving playback order', orderedTwoWorkerPipeline)
  it('aborts both workers and pending playback on cancellation', cancellationAbortsBothWorkers)
  it('bounds Main synthesis concurrency to exactly two workers', mainServiceAllowsExactlyTwo)
  it('uses low-latency first-segment boundaries', firstSegmentBoundaries)
  it(
    'records detailed queue, synthesis, preparation, and playback latency',
    detailedLatencyTelemetry,
  )
})
