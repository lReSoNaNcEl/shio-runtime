const FTS_TERM_LIMIT = 12

const QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'could',
  'do',
  'does',
  'for',
  'from',
  'how',
  'into',
  'is',
  'it',
  'please',
  'tell',
  'the',
  'this',
  'what',
  'where',
  'which',
  'with',
  'you',
  'your',
  'без',
  'был',
  'для',
  'его',
  'если',
  'есть',
  'или',
  'как',
  'когда',
  'коротко',
  'мне',
  'можешь',
  'мой',
  'она',
  'пожалуйста',
  'почему',
  'раз',
  'рассказать',
  'так',
  'тебя',
  'твой',
  'уже',
  'устроен',
  'что',
  'это',
  'этот',
])

const QUERY_STOP_WORD_PATTERNS = [/^расскаж/u, /^использ/u, /^каки/u, /^на$/u]

const PROJECT_CONTEXT_TERMS = new Set([
  'awareness',
  'awarness',
  'project',
  'repository',
  'проект',
  'проекта',
  'проекте',
  'репозиторий',
])

const TECHNICAL_TERM_ALIASES: ReadonlyArray<{
  matches: RegExp
  terms: readonly string[]
}> = [
  { matches: /^(?:api-)?(?:бекенд|бэкенд)$/u, terms: ['backend', 'server', 'api'] },
  { matches: /^голос/u, terms: ['voice', 'speech', 'tts'] },
  { matches: /^озвуч/u, terms: ['tts', 'speech', 'synthesize'] },
  {
    matches: /^(?:технолог\p{L}*|техстек|stack)$/u,
    terms: ['typescript', 'python', 'electron', 'react', 'fastapi', 'dependencies'],
  },
  {
    matches: /^(?:пакет\p{L}*|packages?|package\.json|dependency|dependencies|devdependencies)$/u,
    terms: ['dependencies', 'devdependencies'],
  },
  {
    matches: /^(?:клиент\p{L}*|desktop)$/u,
    terms: ['desktop', 'renderer'],
  },
]

export interface ProjectRetrievalQueryPlan {
  rawQuery: string
  expression: string | null
  normalizedTerms: string[]
  pathTerms: string[]
}

function isQueryStopWord(term: string): boolean {
  return (
    QUERY_STOP_WORDS.has(term) || QUERY_STOP_WORD_PATTERNS.some((pattern) => pattern.test(term))
  )
}

export function compileProjectRetrievalQuery(query: string): ProjectRetrievalQueryPlan {
  const rawTerms =
    query
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}_./-]{2,}/gu) ?? []
  const pathTerms = rawTerms
    .filter((term) => term.includes('/') || /^[\p{L}\p{N}_-]+\.[\p{L}\p{N}_.-]+$/u.test(term))
    .slice(0, 8)
  const expandedTerms: string[] = []
  const seen = new Set<string>()
  const add = (term: string): void => {
    if (term.length < 2 || seen.has(term)) return
    seen.add(term)
    expandedTerms.push(term)
  }
  for (const term of rawTerms) {
    add(term)
    for (const part of term.split(/[./-]+/u)) add(part)
    for (const aliases of TECHNICAL_TERM_ALIASES) {
      if (aliases.matches.test(term)) aliases.terms.forEach(add)
    }
  }

  const meaningfulTerms = expandedTerms.filter((term) => !isQueryStopWord(term))
  const prioritizedTerms = [
    ...meaningfulTerms.filter((term) => !PROJECT_CONTEXT_TERMS.has(term)),
    ...meaningfulTerms.filter((term) => PROJECT_CONTEXT_TERMS.has(term)),
  ]
  const normalizedTerms = (prioritizedTerms.length > 0 ? prioritizedTerms : expandedTerms).slice(
    0,
    FTS_TERM_LIMIT,
  )
  const quotedTerms = normalizedTerms.map((term) => `"${term.replace(/"/g, '""')}"`)
  return {
    rawQuery: query.trim(),
    expression: quotedTerms.length > 0 ? quotedTerms.join(' OR ') : null,
    normalizedTerms,
    pathTerms,
  }
}
