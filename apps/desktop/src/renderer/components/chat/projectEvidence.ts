import type { ProjectEvidenceSource } from '../../../shared/project-awareness'

export interface GroupedProjectEvidence {
  path: string
  ranges: ReadonlyArray<{ startLine?: number; endLine?: number }>
}

export function groupProjectEvidence(
  sources: readonly ProjectEvidenceSource[],
): readonly GroupedProjectEvidence[] {
  const grouped = new Map<string, Array<{ startLine?: number; endLine?: number }>>()
  for (const source of sources) {
    const ranges = grouped.get(source.path) ?? []
    const key = `${source.startLine ?? ''}:${source.endLine ?? ''}`
    if (!ranges.some((range) => `${range.startLine ?? ''}:${range.endLine ?? ''}` === key)) {
      ranges.push({ startLine: source.startLine, endLine: source.endLine })
    }
    grouped.set(source.path, ranges)
  }
  return [...grouped].map(([path, ranges]) => ({ path, ranges }))
}

export function evidenceFileName(path: string): string {
  return path.split('/').at(-1) || path
}
