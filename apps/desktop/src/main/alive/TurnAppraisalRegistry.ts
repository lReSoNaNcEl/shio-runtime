import type { TurnAppraisal } from '../../shared/character-tools'

const MAX_PENDING = 16
const TTL_MS = 5 * 60_000

/** Main-owned, process-memory handoff of one explicit turn's appraisal from the
 * Character turn to its renderer-reported completion. Never persisted or projected. */
export class TurnAppraisalRegistry {
  private readonly pending = new Map<string, { appraisal: TurnAppraisal; at: number }>()

  record(turnId: string, appraisal: TurnAppraisal, at: number): void {
    this.pending.delete(turnId)
    this.pending.set(turnId, { appraisal: Object.freeze({ ...appraisal }), at })
    while (this.pending.size > MAX_PENDING) {
      const oldest = this.pending.keys().next().value
      if (oldest === undefined) break
      this.pending.delete(oldest)
    }
  }

  /** Returns the appraisal at most once; stale entries expire. */
  take(turnId: string, at: number): TurnAppraisal | undefined {
    const entry = this.pending.get(turnId)
    this.pending.delete(turnId)
    return entry && at - entry.at <= TTL_MS ? entry.appraisal : undefined
  }

  clear(): void {
    this.pending.clear()
  }
}
