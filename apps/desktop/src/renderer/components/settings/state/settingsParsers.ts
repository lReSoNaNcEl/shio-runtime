import type { ModelInfo } from '../../../../shared/llm'
import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'

export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? ''

export function parseOverlayViewMode(mode: string | undefined): OverlayViewMode {
  return mode === 'bust' || mode === 'face' || mode === 'portrait' ? mode : 'bust'
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function parseNumberSetting(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value)
  return clampNumber(Number.isFinite(parsed) ? parsed : fallback, min, max)
}

export function projectActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

export function deduplicateModelsById(models: ModelInfo[]): ModelInfo[] {
  const result: ModelInfo[] = []
  const indexById = new Map<string, number>()
  for (const model of models) {
    const existingIndex = indexById.get(model.id)
    if (existingIndex === undefined) {
      indexById.set(model.id, result.length)
      result.push(model)
    } else if (!result[existingIndex].displayName?.trim() && model.displayName?.trim()) {
      result[existingIndex] = model
    }
  }
  return result
}
