import type {
  LatencyMetricName,
  LatencyMetricSummary,
  LatencyMilestone,
  LatencySnapshot,
  LatencyTraceSnapshot,
} from './contracts'

const MAX_TRACES = 64
const MAX_METRIC_SAMPLES = 128

interface MutableTrace {
  turnId: string
  requestId: string
  goalId?: string
  provider?: string
  model?: string
  status?: LatencyMilestone['status']
  startedAt: number
  terminalAt?: number
  milestones: LatencyMilestone[]
}

export type LatencySnapshotListener = (snapshot: LatencySnapshot) => void

export class LatencyTelemetry {
  private readonly traces = new Map<string, MutableTrace>()
  private readonly metricSamples = new Map<LatencyMetricName, number[]>()
  private readonly listeners = new Set<LatencySnapshotListener>()

  record(milestone: LatencyMilestone): void {
    const key = milestone.correlation.turnId
    let trace = this.traces.get(key)
    if (!trace) {
      trace = {
        turnId: milestone.correlation.turnId,
        requestId: milestone.correlation.requestId,
        goalId: milestone.correlation.goalId,
        provider: milestone.provider,
        model: milestone.model,
        startedAt: milestone.at,
        milestones: [],
      }
      this.traces.set(key, trace)
      this.evictOldTraces()
    }
    trace.requestId = milestone.correlation.requestId
    trace.goalId ??= milestone.correlation.goalId
    trace.provider ??= milestone.provider
    trace.model ??= milestone.model
    trace.milestones.push(freezeMilestone(milestone))
    if (milestone.name === 'turn_terminal') {
      trace.terminalAt = milestone.at
      trace.status = milestone.status
      this.collectTraceMetrics(trace)
    }
    this.publish()
  }

  subscribe(listener: LatencySnapshotListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): LatencySnapshot {
    const metrics: Partial<Record<LatencyMetricName, LatencyMetricSummary>> = {}
    for (const [name, samples] of this.metricSamples) metrics[name] = summarize(samples)
    const recentTraces = [...this.traces.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 12)
      .map(toSnapshot)
    return Object.freeze({
      capturedAt: Date.now(),
      metrics: Object.freeze(metrics),
      recentTraces: Object.freeze(recentTraces),
    })
  }

  clear(): void {
    this.traces.clear()
    this.metricSamples.clear()
    this.publish()
  }

  private collectTraceMetrics(trace: MutableTrace): void {
    const first = (name: LatencyMilestone['name']): number | undefined =>
      trace.milestones.find((item) => item.name === name)?.at
    const all = (name: LatencyMilestone['name']): LatencyMilestone[] =>
      trace.milestones.filter((item) => item.name === name)
    const addDuration = (
      metric: LatencyMetricName,
      start: number | undefined,
      end: number | undefined,
    ): void => {
      if (start === undefined || end === undefined || end < start) return
      this.addSample(metric, end - start)
    }

    const inputAt =
      first('input_received') ?? first('text_submitted') ?? first('utterance_completed')
    addDuration('asrFinal', first('speech_ended'), first('asr_final'))
    addDuration('llmConnect', first('llm_request_started'), first('llm_connected'))
    addDuration('llmTtft', first('llm_request_started'), first('llm_first_text_delta'))
    addDuration('llmFirstSentence', first('llm_request_started'), first('llm_first_sentence'))
    addDuration('llmTotal', first('llm_request_started'), first('llm_completed'))
    addDuration('firstAudio', inputAt, first('first_audio_ready'))
    addDuration('timeToPlayback', inputAt, first('playback_started'))
    addDuration('fullTurn', inputAt, first('turn_terminal'))

    pairByCorrelation(all('tool_round_started'), all('tool_round_completed'), 'llmRound', (value) =>
      this.addSample('toolRound', value),
    )
    pairByCorrelation(
      all('tts_segment_requested'),
      all('tts_segment_ready'),
      'ttsSegmentId',
      (value) => this.addSample('ttsSynthesis', value),
    )
  }

  private addSample(name: LatencyMetricName, value: number): void {
    if (!Number.isFinite(value) || value < 0) return
    const samples = this.metricSamples.get(name) ?? []
    samples.push(value)
    if (samples.length > MAX_METRIC_SAMPLES) samples.splice(0, samples.length - MAX_METRIC_SAMPLES)
    this.metricSamples.set(name, samples)
  }

  private evictOldTraces(): void {
    if (this.traces.size <= MAX_TRACES) return
    const oldest = [...this.traces.values()].sort((a, b) => a.startedAt - b.startedAt)[0]
    if (oldest) this.traces.delete(oldest.turnId)
  }

  private publish(): void {
    if (this.listeners.size === 0) return
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

function freezeMilestone(milestone: LatencyMilestone): LatencyMilestone {
  return Object.freeze({
    ...milestone,
    correlation: Object.freeze({ ...milestone.correlation }),
  })
}

function toSnapshot(trace: MutableTrace): LatencyTraceSnapshot {
  return Object.freeze({
    turnId: trace.turnId,
    requestId: trace.requestId,
    goalId: trace.goalId,
    provider: trace.provider,
    model: trace.model,
    status: trace.status,
    startedAt: trace.startedAt,
    terminalAt: trace.terminalAt,
    milestones: Object.freeze([...trace.milestones]),
  })
}

function summarize(samples: readonly number[]): LatencyMetricSummary {
  const sorted = [...samples].sort((a, b) => a - b)
  return Object.freeze({
    count: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: Math.round(sorted.at(-1) ?? 0),
  })
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  return Math.round(sorted[index] ?? 0)
}

function pairByCorrelation(
  starts: readonly LatencyMilestone[],
  ends: readonly LatencyMilestone[],
  field: 'llmRound' | 'ttsSegmentId',
  collect: (durationMs: number) => void,
): void {
  for (const start of starts) {
    const value = start.correlation[field]
    const end = ends.find((candidate) => candidate.correlation[field] === value)
    if (end && end.at >= start.at) collect(end.at - start.at)
  }
}
