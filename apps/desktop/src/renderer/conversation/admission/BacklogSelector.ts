import { backlogTuning } from '../../speech/continuous-listening/tuning'
import type { BufferedUtterance } from '../../speech/continuous-listening/types'
import type { UtteranceBacklog } from '../../speech/continuous-listening/UtteranceBacklog'

interface BacklogSelection {
  selectedIds: string[]
  text: string
  backlogVersion: number
}

export interface BacklogSelectorDiagnostics {
  ambiguousQueues: number
  deterministicSelections: number
}

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
  private diagnostics: BacklogSelectorDiagnostics = {
    ambiguousQueues: 0,
    deterministicSelections: 0,
  }

  getDiagnostics(): BacklogSelectorDiagnostics {
    return { ...this.diagnostics }
  }

  select(backlog: UtteranceBacklog): BacklogSelection | null {
    backlog.purge()
    const version = backlog.getVersion()
    const items = backlog.snapshot()
    const [winner, runnerUp] = [...items].sort((a, b) => this.compareItems(a, b))
    if (!winner) return null
    if (
      runnerUp &&
      winner.priorityClass === runnerUp.priorityClass &&
      winner.attentionScore - runnerUp.attentionScore < 15
    ) {
      this.diagnostics.ambiguousQueues += 1
    }
    this.diagnostics.deterministicSelections += 1
    return this.withSimpleMerge(winner, items, version)
  }

  private withSimpleMerge(
    winner: BufferedUtterance,
    items: readonly BufferedUtterance[],
    version: number,
  ): BacklogSelection {
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
      selectedIds: selected.map((item) => item.id),
      text: selected.length > 1 ? mergedText : winner.text,
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
}
