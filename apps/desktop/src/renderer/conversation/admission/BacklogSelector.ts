import { backlogTuning } from '../../speech/continuous-listening/tuning'
import type {
  BacklogSelectionResult,
  BufferedUtterance,
} from '../../speech/continuous-listening/types'
import type { UtteranceBacklog } from '../../speech/continuous-listening/UtteranceBacklog'

export interface BacklogSelectorLlmConfig {
  enabled: boolean
  providerId: string
  model: string
  timeoutMs: number
  minimumConfidence: number
}

export interface BacklogSelectorContext {
  continuousEnabled: boolean
  llm: BacklogSelectorLlmConfig
}

export type BacklogArbitrator = (
  items: readonly BufferedUtterance[],
  version: number,
  config: BacklogSelectorLlmConfig,
) => Promise<BacklogSelectionResult>

export interface BacklogSelectorDiagnostics {
  ambiguousQueues: number
  llmArbitrations: number
  deterministicSelections: number
  timeouts: number
  fallbacks: number
  cancelled: number
  averageArbitrationLatencyMs: number
}

class BacklogArbitrationTimeoutError extends Error {}

const priorityRank: Record<BufferedUtterance['priorityClass'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
}
const correctionPattern =
  /(?:^|\s)(?:нет|стоп|подожди|погоди|я имел[а]? в виду|поправка)(?:$|[\s,.!?])/iu
const continuationPattern = /(?:^|\s)(?:и ещё|ещё|точнее|то есть|лучше|в смысле)(?:$|[\s,.!?])/iu

export class BacklogSelector {
  private arbitrationInFlight = false
  private arbitrationId = 0
  private generation = 0
  private diagnostics: BacklogSelectorDiagnostics = {
    ambiguousQueues: 0,
    llmArbitrations: 0,
    deterministicSelections: 0,
    timeouts: 0,
    fallbacks: 0,
    cancelled: 0,
    averageArbitrationLatencyMs: 0,
  }
  private arbitrationLatencyTotalMs = 0

  constructor(private readonly arbitrate?: BacklogArbitrator) {}

  cancel(): void {
    if (this.arbitrationInFlight) this.diagnostics.cancelled += 1
    this.generation += 1
    this.arbitrationId += 1
    this.arbitrationInFlight = false
  }

  getDiagnostics(): BacklogSelectorDiagnostics {
    return { ...this.diagnostics }
  }

  async select(
    backlog: UtteranceBacklog,
    context: BacklogSelectorContext,
  ): Promise<BacklogSelectionResult> {
    backlog.purge()
    const version = backlog.getVersion()
    const items = backlog.snapshot()
    if (!context.continuousEnabled || items.length === 0)
      return this.discard(version, 'streaming_disabled_or_empty')

    const clearWinner = this.unambiguousHighPriorityWinner(items)
    if (clearWinner) {
      this.diagnostics.deterministicSelections += 1
      return this.withSimpleMerge(clearWinner, items, version, 'deterministic_high_priority')
    }

    const llmConfig = {
      ...context.llm,
      providerId: context.llm.providerId.trim(),
      model: context.llm.model.trim(),
    }
    const arbitrate = this.arbitrate
    const ambiguous = this.selectionIsAmbiguous(items)
    if (ambiguous) this.diagnostics.ambiguousQueues += 1
    const llmEligible =
      llmConfig.enabled &&
      Boolean(llmConfig.providerId && llmConfig.model) &&
      llmConfig.timeoutMs > 0 &&
      llmConfig.minimumConfidence >= 0 &&
      llmConfig.minimumConfidence <= 1 &&
      items.length >= 2 &&
      ambiguous &&
      !this.arbitrationInFlight &&
      Boolean(arbitrate)
    if (llmEligible && arbitrate) {
      const generation = ++this.generation
      const arbitrationId = ++this.arbitrationId
      this.arbitrationInFlight = true
      this.diagnostics.llmArbitrations += 1
      const startedAt = performance.now()
      try {
        const result = await this.withTimeout(
          Promise.resolve().then(() => arbitrate(items, version, llmConfig)),
          llmConfig.timeoutMs,
        )
        if (
          backlog.getVersion() !== version ||
          result.backlogVersion !== version ||
          generation !== this.generation
        ) {
          return this.fallback(backlog.snapshot(), backlog.getVersion(), 'stale_llm_fallback')
        }
        const snapshotIds = new Set(items.map((item) => item.id))
        const validIds = result.selectedIds.every((id) => snapshotIds.has(id) && backlog.has(id))
        const validAction =
          result.action === 'discard_all'
            ? result.selectedIds.length === 0
            : Boolean(result.text?.trim()) &&
              (result.action === 'select'
                ? result.selectedIds.length === 1
                : result.selectedIds.length >= 2)
        if (result.confidence >= llmConfig.minimumConfidence && validIds && validAction)
          return result
        return this.fallback(items, version, 'low_confidence_or_schema_fallback')
      } catch (error) {
        if (error instanceof BacklogArbitrationTimeoutError) this.diagnostics.timeouts += 1
        return this.fallback(backlog.snapshot(), backlog.getVersion(), 'llm_error_fallback')
      } finally {
        this.arbitrationLatencyTotalMs += performance.now() - startedAt
        this.diagnostics.averageArbitrationLatencyMs = Math.round(
          this.arbitrationLatencyTotalMs / this.diagnostics.llmArbitrations,
        )
        if (arbitrationId === this.arbitrationId) this.arbitrationInFlight = false
      }
    }
    return this.deterministic(items, version, 'deterministic_fallback')
  }

  private deterministic(
    items: readonly BufferedUtterance[],
    version: number,
    reason: string,
  ): BacklogSelectionResult {
    this.diagnostics.deterministicSelections += 1
    if (items.length === 0) return this.discard(version, reason)
    const sorted = [...items].sort((a, b) => this.compareItems(a, b))
    return this.withSimpleMerge(sorted[0], items, version, reason)
  }

  private fallback(
    items: readonly BufferedUtterance[],
    version: number,
    reason: string,
  ): BacklogSelectionResult {
    this.diagnostics.fallbacks += 1
    return this.deterministic(items, version, reason)
  }

  private unambiguousHighPriorityWinner(
    items: readonly BufferedUtterance[],
  ): BufferedUtterance | null {
    const high = items.filter((item) => item.priorityClass === 'P0' || item.priorityClass === 'P1')
    if (high.length === 0) return null
    const sorted = [...high].sort((a, b) => this.compareItems(a, b))
    const first = sorted[0]
    const second = sorted[1]
    return !second ||
      priorityRank[first.priorityClass] < priorityRank[second.priorityClass] ||
      first.attentionScore - second.attentionScore >= 15
      ? first
      : null
  }

  private selectionIsAmbiguous(items: readonly BufferedUtterance[]): boolean {
    if (items.length < 2) return false
    const sorted = [...items].sort((a, b) => this.compareItems(a, b))
    return (
      priorityRank[sorted[0].priorityClass] === priorityRank[sorted[1].priorityClass] &&
      Math.abs(sorted[0].attentionScore - sorted[1].attentionScore) < 15
    )
  }

  private withSimpleMerge(
    winner: BufferedUtterance,
    items: readonly BufferedUtterance[],
    version: number,
    reason: string,
  ): BacklogSelectionResult {
    const related = items
      .filter(
        (item) =>
          item.streamingSessionId === winner.streamingSessionId &&
          Math.abs(item.createdAt - winner.createdAt) <= backlogTuning.mergeWindowMs &&
          (item.id === winner.id ||
            item.followUpHint ||
            item.correctionHint ||
            correctionPattern.test(item.text) ||
            continuationPattern.test(item.text)),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
    const mergedText = related.map((item) => item.text.trim()).join(' ')
    const selected =
      related.length > 1 && mergedText.length <= backlogTuning.maxMergedCharacters
        ? related
        : [winner]
    return {
      action: selected.length > 1 ? 'merge' : 'select',
      selectedIds: selected.map((item) => item.id),
      text: selected.length > 1 ? mergedText : winner.text,
      reason,
      confidence: 1,
      backlogVersion: version,
    }
  }

  private discard(version: number, reason: string): BacklogSelectionResult {
    return {
      action: 'discard_all',
      selectedIds: [],
      reason,
      confidence: 1,
      backlogVersion: version,
    }
  }

  private compareItems(a: BufferedUtterance, b: BufferedUtterance): number {
    return (
      priorityRank[a.priorityClass] - priorityRank[b.priorityClass] ||
      b.attentionScore - a.attentionScore ||
      b.createdAt - a.createdAt ||
      a.id.localeCompare(b.id)
    )
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new BacklogArbitrationTimeoutError()), timeoutMs)
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }
}
