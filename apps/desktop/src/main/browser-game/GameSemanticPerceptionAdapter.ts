import { z } from 'zod'

import type { GameFrame } from '../../shared/browser-game'
import type { GameEventExtractionContext } from './GameEventExtractor'

export const gameSemanticPhaseSchema = z.enum([
  'unknown',
  'playing',
  'round-start',
  'paused',
  'game-over',
])

export const gameSemanticPerceptionSnapshotSchema = z
  .object({
    phase: gameSemanticPhaseSchema,
    score: z.number().finite().min(-1_000_000_000).max(1_000_000_000).nullable(),
    lives: z.number().int().min(0).max(1_000_000).nullable(),
    checkpoint: z.string().trim().min(1).max(120).nullable(),
    levelCompleted: z.boolean(),
    newRecord: z.boolean(),
    label: z.string().trim().min(1).max(120).nullable(),
    confidence: z.number().finite().min(0).max(1),
  })
  .strict()

export type GameSemanticPerceptionSnapshot = z.infer<typeof gameSemanticPerceptionSnapshotSchema>

export interface GameSemanticPerceptionStatus {
  backendId: string
  ready: boolean
  sampleRateHz: number
}

/**
 * Replaceable slow perception technology. It receives only a transient cropped
 * game frame and returns bounded present-state evidence; it owns no input or Action authority.
 */
export interface GameSemanticPerceptionAdapter {
  status(): GameSemanticPerceptionStatus
  analyze(
    frame: GameFrame,
    state: GameEventExtractionContext,
    previous: GameSemanticPerceptionSnapshot | null,
    signal: AbortSignal,
  ): Promise<GameSemanticPerceptionSnapshot | null>
  reset(): void
}
