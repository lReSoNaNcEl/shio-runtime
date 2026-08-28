import { posix } from 'node:path'

import type { ProjectRetrievalCandidate } from '../ProjectKnowledgeStore'
import type { ProjectRetrievalQueryPlan } from './ProjectRetrievalQueryCompiler'

const DEPENDENCY_SECTION_NAMES = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
])
const MANIFEST_QUERY_TERMS = new Set([
  'dependencies',
  'devdependencies',
  'json',
  'package',
  'package.json',
  'packages',
])
const MAX_MANIFEST_FRAGMENT_CHARACTERS = 1_400

interface JsonPropertyRange {
  name: string
  startOffset: number
  endOffset: number
}

export function isPackageManifestDependencyQuery(
  plans: readonly ProjectRetrievalQueryPlan[],
): boolean {
  const terms = new Set(plans.flatMap((plan) => plan.normalizedTerms))
  return (
    (terms.has('dependencies') || terms.has('devdependencies')) &&
    plans.some((plan) =>
      plan.pathTerms.some((term) => posix.basename(term).toLowerCase() === 'package.json'),
    )
  )
}

export function buildPackageManifestDependencyCandidates(
  candidates: readonly ProjectRetrievalCandidate[],
  normalizedTerms: readonly string[],
  readIndexedFile: (path: string) => string | null,
): ProjectRetrievalCandidate[] {
  const manifestPaths = candidates
    .map((candidate) => candidate.path)
    .filter(
      (path, index, paths) =>
        posix.basename(path).toLowerCase() === 'package.json' && paths.indexOf(path) === index,
    )
  if (manifestPaths.length === 0) return []

  const pathTerms = normalizedTerms.filter(
    (term) => term.length >= 3 && !MANIFEST_QUERY_TERMS.has(term),
  )
  const pathScores = manifestPaths.map((path) => ({
    path,
    score: pathTerms.filter((term) => path.toLowerCase().includes(term)).length,
  }))
  const bestPathScore = Math.max(...pathScores.map(({ score }) => score))
  const selectedPaths = pathScores
    .filter(({ score }) => bestPathScore === 0 || score === bestPathScore)
    .map(({ path }) => path)

  let nextCandidateId = -1
  return selectedPaths.flatMap((path, pathOrdinal) => {
    const content = readIndexedFile(path)
    if (!content) return []
    const dependencyRanges = topLevelJsonProperties(content).filter(({ name }) =>
      DEPENDENCY_SECTION_NAMES.has(name),
    )
    const ranges =
      dependencyRanges.length > 0
        ? dependencyRanges
        : [{ name: 'package.json', startOffset: 0, endOffset: content.length }]
    return ranges.flatMap((range) =>
      splitRange(content, range).map((fragment) => ({
        id: nextCandidateId--,
        path,
        startLine: fragment.startLine,
        endLine: fragment.endLine,
        symbol: range.name,
        content: fragment.content,
        matches: [{ kind: 'path' as const, ordinal: pathOrdinal }],
      })),
    )
  })
}

function topLevelJsonProperties(content: string): JsonPropertyRange[] {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  } catch {
    return []
  }

  const ranges: JsonPropertyRange[] = []
  let cursor = skipWhitespace(content, 0)
  if (content[cursor] !== '{') return []
  cursor += 1
  while (cursor < content.length) {
    cursor = skipWhitespaceAndCommas(content, cursor)
    if (content[cursor] === '}') break
    if (content[cursor] !== '"') return []
    const keyStart = cursor
    const keyEnd = stringEnd(content, keyStart)
    if (keyEnd <= keyStart) return []
    let name: string
    try {
      name = JSON.parse(content.slice(keyStart, keyEnd)) as string
    } catch {
      return []
    }
    cursor = skipWhitespace(content, keyEnd)
    if (content[cursor] !== ':') return []
    const valueStart = skipWhitespace(content, cursor + 1)
    const valueEnd = jsonValueEnd(content, valueStart)
    if (valueEnd <= valueStart) return []
    ranges.push({ name, startOffset: keyStart, endOffset: valueEnd })
    cursor = valueEnd
  }
  return ranges
}

function skipWhitespace(content: string, start: number): number {
  let cursor = start
  while (cursor < content.length && /\s/u.test(content[cursor] ?? '')) cursor += 1
  return cursor
}

function skipWhitespaceAndCommas(content: string, start: number): number {
  let cursor = start
  while (
    cursor < content.length &&
    (content[cursor] === ',' || /\s/u.test(content[cursor] ?? ''))
  ) {
    cursor += 1
  }
  return cursor
}

function stringEnd(content: string, start: number): number {
  let escaped = false
  for (let cursor = start + 1; cursor < content.length; cursor += 1) {
    const character = content[cursor]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') return cursor + 1
  }
  return -1
}

function jsonValueEnd(content: string, start: number): number {
  const first = content[start]
  if (first === '"') return stringEnd(content, start)
  if (first === '{' || first === '[') {
    const closing: string[] = [first === '{' ? '}' : ']']
    for (let cursor = start + 1; cursor < content.length; cursor += 1) {
      const character = content[cursor]
      if (character === '"') {
        const end = stringEnd(content, cursor)
        if (end < 0) return -1
        cursor = end - 1
        continue
      }
      if (character === '{') closing.push('}')
      else if (character === '[') closing.push(']')
      else if (character === closing.at(-1)) {
        closing.pop()
        if (closing.length === 0) return cursor + 1
      }
    }
    return -1
  }

  let cursor = start
  while (cursor < content.length && content[cursor] !== ',' && content[cursor] !== '}') cursor += 1
  while (cursor > start && /\s/u.test(content[cursor - 1] ?? '')) cursor -= 1
  return cursor
}

function splitRange(
  source: string,
  range: JsonPropertyRange,
): Array<{ startLine: number; endLine: number; content: string }> {
  const fragments: Array<{ startLine: number; endLine: number; content: string }> = []
  let cursor = range.startOffset
  while (cursor < range.endOffset) {
    const desiredEnd = Math.min(range.endOffset, cursor + MAX_MANIFEST_FRAGMENT_CHARACTERS)
    const newline =
      desiredEnd < range.endOffset ? source.lastIndexOf('\n', desiredEnd) : range.endOffset
    const end = newline > cursor ? newline : desiredEnd
    const content = source.slice(cursor, end)
    if (!content) break
    const startLine = lineAt(source, cursor)
    fragments.push({
      startLine,
      endLine: startLine + newlineCount(content),
      content,
    })
    cursor = end
    if (source[cursor] === '\n') cursor += 1
  }
  return fragments
}

function lineAt(content: string, offset: number): number {
  return newlineCount(content.slice(0, offset)) + 1
}

function newlineCount(content: string): number {
  return content.match(/\n/gu)?.length ?? 0
}
