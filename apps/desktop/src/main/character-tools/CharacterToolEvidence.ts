import {
  CHARACTER_TOOL_IDS,
  type CharacterToolId,
  type CharacterToolRequirement,
  type CharacterToolSourceId,
  type TurnToolEvidenceSummary,
} from '../../shared/character-tools'
import type { CharacterToolDispatchResult } from './CharacterToolDispatcher'
import type { CharacterToolRegistry } from './CharacterToolRegistry'

/**
 * Runtime-owned Turn Tool Evidence for one Character turn: bounded attempted/succeeded facts
 * per tool and the typed Tool Requirement status derived from them. Raw tool payloads are
 * parsed only for counts and freshness and are never retained.
 */
export interface ToolAttempt {
  tool: CharacterToolId
  succeeded: boolean
  resultCount?: number
  freshestSourceAt?: number
}

export interface ToolEvidenceState {
  requirement: CharacterToolRequirement
  toolAttempts: ToolAttempt[]
}

export const SOURCE_TOOL_IDS: Readonly<Record<CharacterToolSourceId, readonly CharacterToolId[]>> =
  {
    web: ['web.search'],
    project: ['project.search'],
    memory: ['memory.search', 'memory.list'],
    'browser-state': ['browser.observe', 'browser.tabs', 'browser.useStatus'],
  }

const BROWSER_EVIDENCE_TOOL_IDS: readonly CharacterToolId[] = Object.freeze(
  CHARACTER_TOOL_IDS.filter((tool) => tool.startsWith('browser.')),
)

export type ToolRequirementStatus =
  | 'not-required'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'unavailable'

function requirementTools(requirement: CharacterToolRequirement): readonly CharacterToolId[] {
  if (requirement.type === 'direct-answer' || requirement.type === 'source-preferred') return []
  if (requirement.type === 'explicit-tool') return [requirement.tool]
  return SOURCE_TOOL_IDS[requirement.source]
}

export function requirementStatus(
  requirement: CharacterToolRequirement,
  state: ToolEvidenceState,
  registry: CharacterToolRegistry,
): ToolRequirementStatus {
  if (requirement.type === 'direct-answer' || requirement.type === 'source-preferred') {
    return 'not-required'
  }
  const required = new Set(requirementTools(requirement))
  const attempts = state.toolAttempts.filter((attempt) => required.has(attempt.tool))
  if (attempts.some((attempt) => attempt.succeeded)) return 'succeeded'
  if (attempts.length > 0) return 'failed'
  if (!registry.definitions().some((tool) => required.has(tool.id))) return 'unavailable'
  return 'pending'
}

function parsedToolResult(content: string): {
  succeeded: boolean
  resultCount?: number
  freshestSourceAt?: number
} {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { succeeded: false }
    const record = parsed as Record<string, unknown>
    if (record.ok !== true) return { succeeded: false }
    const data =
      record.data && typeof record.data === 'object' && !Array.isArray(record.data)
        ? (record.data as Record<string, unknown>)
        : undefined
    const results = Array.isArray(data?.results) ? data.results : undefined
    const publishedTimes = (results ?? []).flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const publishedAt = (item as Record<string, unknown>).publishedAt
      if (typeof publishedAt !== 'string') return []
      const value = Date.parse(publishedAt)
      return Number.isFinite(value) ? [value] : []
    })
    return {
      succeeded: true,
      ...(results ? { resultCount: results.length } : {}),
      ...(publishedTimes.length > 0 ? { freshestSourceAt: Math.max(...publishedTimes) } : {}),
    }
  } catch {
    return { succeeded: false }
  }
}

export function recordToolAttempt(
  state: ToolEvidenceState,
  tool: CharacterToolId,
  result: CharacterToolDispatchResult,
): void {
  state.toolAttempts.push({ tool, ...parsedToolResult(result.content) })
}

function sourceEvidence(
  attempts: readonly ToolAttempt[],
  tools: readonly CharacterToolId[],
): TurnToolEvidenceSummary['web'] {
  const allowed = new Set(tools)
  const matching = attempts.filter((attempt) => allowed.has(attempt.tool))
  const resultCount = matching.reduce((total, attempt) => total + (attempt.resultCount ?? 0), 0)
  const freshest = matching.flatMap((attempt) =>
    attempt.freshestSourceAt === undefined ? [] : [attempt.freshestSourceAt],
  )
  return Object.freeze({
    used: matching.length > 0,
    succeeded: matching.some((attempt) => attempt.succeeded),
    ...(matching.some((attempt) => attempt.resultCount !== undefined) ? { resultCount } : {}),
    ...(freshest.length > 0 ? { freshestSourceAt: Math.max(...freshest) } : {}),
  })
}

export function toolEvidenceSummary(state: ToolEvidenceState): TurnToolEvidenceSummary {
  const executedTools = [...new Set(state.toolAttempts.map((attempt) => attempt.tool))]
  const failedTools = executedTools.filter(
    (tool) => !state.toolAttempts.some((attempt) => attempt.tool === tool && attempt.succeeded),
  )
  return Object.freeze({
    requirement: Object.freeze({ ...state.requirement }) as CharacterToolRequirement,
    executedTools: Object.freeze(executedTools),
    failedTools: Object.freeze(failedTools),
    web: sourceEvidence(state.toolAttempts, SOURCE_TOOL_IDS.web),
    project: sourceEvidence(state.toolAttempts, SOURCE_TOOL_IDS.project),
    browser: sourceEvidence(state.toolAttempts, BROWSER_EVIDENCE_TOOL_IDS),
    memory: sourceEvidence(state.toolAttempts, SOURCE_TOOL_IDS.memory),
  })
}
