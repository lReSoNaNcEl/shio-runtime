import type { ProjectEvidence } from '../../../shared/project-awareness'
import type { ProjectRetrievalCandidate, ProjectRetrievalMatchKind } from '../ProjectKnowledgeStore'

export const PROJECT_CONTEXT_BUDGET = Object.freeze({
  candidateLimit: 48,
  maxEvidenceSources: 6,
  maxFragmentsPerSource: 4,
  maxFragmentCharacters: 1_400,
  maxSourceCharacters: 4_200,
  maxTotalEvidenceCharacters: 6_000,
  maxMapSummaryCharacters: 1_000,
  maxPacketPayloadCharacters: 7_500,
  maxRenderedPromptCharacters: 10_000,
})

const WEAK_RETRIEVAL_BUDGET = Object.freeze({
  maxEvidenceSources: 2,
  maxFragmentsPerSource: 1,
  maxFragmentCharacters: 1_200,
  maxSourceCharacters: 1_200,
  maxTotalEvidenceCharacters: 2_200,
})

const APPROXIMATE_CHARACTERS_PER_TOKEN = 4

export type ProjectRetrievalQuality = 'strong' | 'weak' | 'none'

export interface ProjectEvidenceSelectionSource {
  path: string
  fragments: number
  characters: number
  estimatedLlmUnits: number
}

export interface ProjectEvidenceSelection {
  evidence: ProjectEvidence[]
  quality: ProjectRetrievalQuality
  selectedSources: ProjectEvidenceSelectionSource[]
  totalEvidenceCharacters: number
  estimatedEvidenceLlmUnits: number
  chargedPacketCharacters: number
}

interface RankedCandidate {
  candidate: ProjectRetrievalCandidate
  relevance: number
  matchedTermCount: number
}

export interface ProjectEvidenceSelectionOptions {
  commitSha: string
  normalizedTerms: readonly string[]
  maxEvidenceSources?: number
  maxFragmentsPerSource?: number
  maxFragmentCharacters?: number
  maxSourceCharacters?: number
  maxTotalEvidenceCharacters?: number
  maxEvidenceItems?: number
  maxPacketPayloadCharacters?: number
  reservedPacketCharacters?: number
}

function matchScore(kind: ProjectRetrievalMatchKind, ordinal: number): number {
  switch (kind) {
    case 'symbol':
      return 1
    case 'path':
      return 0.92
    case 'fts':
      return Math.max(0.56, 0.72 - ordinal * 0.008)
  }
}

function rankCandidate(
  candidate: ProjectRetrievalCandidate,
  normalizedTerms: readonly string[],
): RankedCandidate {
  const searchable =
    `${candidate.path}\n${candidate.symbol ?? ''}\n${candidate.content}`.toLowerCase()
  const matchedTermCount = normalizedTerms.filter((term) => searchable.includes(term)).length
  const coverage =
    normalizedTerms.length > 0 ? matchedTermCount / Math.min(normalizedTerms.length, 4) : 0
  const base = Math.max(...candidate.matches.map((match) => matchScore(match.kind, match.ordinal)))
  return {
    candidate,
    matchedTermCount,
    relevance: Math.min(1, base + Math.min(0.07, coverage * 0.07)),
  }
}

function projectRetrievalQuality(candidates: readonly RankedCandidate[]): ProjectRetrievalQuality {
  if (candidates.length === 0) return 'none'
  if (
    candidates.some(
      ({ candidate, matchedTermCount, relevance }) =>
        relevance >= 0.86 ||
        matchedTermCount >= 2 ||
        candidate.matches.some((match) => match.kind === 'symbol' || match.kind === 'path'),
    )
  ) {
    return 'strong'
  }
  return 'weak'
}

function truncatedEndLine(candidate: ProjectRetrievalCandidate, content: string): number {
  const lineCount = content.split('\n').length
  return Math.min(candidate.endLine, candidate.startLine + Math.max(0, lineCount - 1))
}

function estimatedLlmUnits(characters: number): number {
  return Math.ceil(characters / APPROXIMATE_CHARACTERS_PER_TOKEN)
}

export function selectProjectEvidence(
  candidates: readonly ProjectRetrievalCandidate[],
  options: ProjectEvidenceSelectionOptions,
): ProjectEvidenceSelection {
  const ranked = candidates
    .map((candidate) => rankCandidate(candidate, options.normalizedTerms))
    .sort(
      (left, right) =>
        right.relevance - left.relevance ||
        right.matchedTermCount - left.matchedTermCount ||
        left.candidate.path.localeCompare(right.candidate.path) ||
        left.candidate.startLine - right.candidate.startLine,
    )
  const quality = projectRetrievalQuality(ranked)
  if (quality === 'none') {
    return {
      evidence: [],
      quality,
      selectedSources: [],
      totalEvidenceCharacters: 0,
      estimatedEvidenceLlmUnits: 0,
      chargedPacketCharacters: options.reservedPacketCharacters ?? 0,
    }
  }

  const qualityBudget = quality === 'weak' ? WEAK_RETRIEVAL_BUDGET : PROJECT_CONTEXT_BUDGET
  const maxEvidenceSources = Math.max(
    1,
    Math.min(
      options.maxEvidenceSources ?? qualityBudget.maxEvidenceSources,
      qualityBudget.maxEvidenceSources,
    ),
  )
  const maxFragmentsPerSource = Math.max(
    1,
    Math.min(
      options.maxFragmentsPerSource ?? qualityBudget.maxFragmentsPerSource,
      qualityBudget.maxFragmentsPerSource,
    ),
  )
  const maxFragmentCharacters = Math.max(
    1,
    Math.min(
      options.maxFragmentCharacters ?? qualityBudget.maxFragmentCharacters,
      qualityBudget.maxFragmentCharacters,
    ),
  )
  const maxSourceCharacters = Math.max(
    1,
    Math.min(
      options.maxSourceCharacters ?? qualityBudget.maxSourceCharacters,
      qualityBudget.maxSourceCharacters,
    ),
  )
  const maxTotalEvidenceCharacters = Math.max(
    1,
    Math.min(
      options.maxTotalEvidenceCharacters ?? qualityBudget.maxTotalEvidenceCharacters,
      qualityBudget.maxTotalEvidenceCharacters,
    ),
  )
  const maxEvidenceItems = Math.max(
    1,
    Math.min(
      options.maxEvidenceItems ?? maxEvidenceSources * maxFragmentsPerSource,
      maxEvidenceSources * maxFragmentsPerSource,
    ),
  )
  const maxPacketPayloadCharacters = Math.max(
    1,
    options.maxPacketPayloadCharacters ?? PROJECT_CONTEXT_BUDGET.maxPacketPayloadCharacters,
  )

  const bySource = new Map<string, RankedCandidate[]>()
  for (const item of ranked) {
    const source = bySource.get(item.candidate.path)
    if (source) source.push(item)
    else bySource.set(item.candidate.path, [item])
  }
  const sourceGroups = [...bySource.entries()]
    .sort(
      ([leftPath, left], [rightPath, right]) =>
        (right[0]?.relevance ?? 0) - (left[0]?.relevance ?? 0) || leftPath.localeCompare(rightPath),
    )
    .slice(0, maxEvidenceSources)

  const evidence: ProjectEvidence[] = []
  const sourceCharacters = new Map<string, number>()
  let totalEvidenceCharacters = 0
  let chargedPacketCharacters = options.reservedPacketCharacters ?? 0

  for (let fragmentIndex = 0; fragmentIndex < maxFragmentsPerSource; fragmentIndex += 1) {
    for (const [path, source] of sourceGroups) {
      if (
        evidence.length >= maxEvidenceItems ||
        totalEvidenceCharacters >= maxTotalEvidenceCharacters ||
        chargedPacketCharacters >= maxPacketPayloadCharacters
      ) {
        break
      }
      const rankedCandidate = source[fragmentIndex]
      if (!rankedCandidate) continue
      const usedBySource = sourceCharacters.get(path) ?? 0
      const metadataCharge =
        rankedCandidate.candidate.path.length + (rankedCandidate.candidate.symbol?.length ?? 0) + 64
      const contentLimit = Math.min(
        maxFragmentCharacters,
        maxSourceCharacters - usedBySource,
        maxTotalEvidenceCharacters - totalEvidenceCharacters,
        maxPacketPayloadCharacters - chargedPacketCharacters - metadataCharge,
      )
      if (contentLimit <= 0) continue
      const content = rankedCandidate.candidate.content.slice(0, contentLimit)
      if (!content) continue
      const characters = content.length
      evidence.push({
        path: rankedCandidate.candidate.path,
        startLine: rankedCandidate.candidate.startLine,
        endLine: truncatedEndLine(rankedCandidate.candidate, content),
        ...(rankedCandidate.candidate.symbol ? { symbol: rankedCandidate.candidate.symbol } : {}),
        commitSha: options.commitSha,
        content,
        relevance: rankedCandidate.relevance,
      })
      sourceCharacters.set(path, usedBySource + characters)
      totalEvidenceCharacters += characters
      chargedPacketCharacters += metadataCharge + characters
    }
  }

  const selectedSources = [...sourceCharacters.entries()].map(([path, characters]) => ({
    path,
    fragments: evidence.filter((item) => item.path === path).length,
    characters,
    estimatedLlmUnits: estimatedLlmUnits(characters),
  }))
  return {
    evidence,
    quality: evidence.length > 0 ? quality : 'none',
    selectedSources,
    totalEvidenceCharacters,
    estimatedEvidenceLlmUnits: estimatedLlmUnits(totalEvidenceCharacters),
    chargedPacketCharacters,
  }
}
