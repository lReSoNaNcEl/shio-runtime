import type { ProjectContextRequirement } from '../../shared/project-awareness'

const EXPLICIT_PROJECT_SCOPE_SHAPE =
  /\b(?:shio runtime|project|repository|repo|codebase|github|memory layer|character state|action runtime|avatar runtime|speech runtime|conversation runtime|project awareness)\b|проект|репозитор|гитхаб|кодовая\s+баз/u

const PROJECT_KNOWLEDGE_SHAPE =
  /\b(?:commit|branch|architecture|code|source|file|class|function)\b|коммит|ветк|\bкод\b|исходник|файл|класс|функци|архитектур/u

const OPTIONAL_PROJECT_TERMS = [
  'runtime',
  'typescript',
  'backend',
  'speech api',
  'tts',
  'asr',
  'f5-tts',
  'electron',
  'renderer',
  'adapter',
  'рантайм',
  'устройств',
  'ошибк',
  'баг',
  'сломал',
  'почему раньше',
  'что в тебе поменял',
  'как ты работа',
  'бекенд',
  'бэкенд',
  'голос',
  'озвуч',
  'синтез реч',
  'распознаван',
]

const SOURCE_FILE_SHAPE =
  /(?:^|[\s`])([\w./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|jsonc|yaml|yml|toml|ini|xml|cs|go|rs|java|kt|kts|swift|sh|ps1))(?:$|[\s`.,:?!])/giu

const TECHNICAL_SYMBOL_SHAPE =
  /(?:^|[\s`])[A-Z][A-Za-z0-9]*(?:Runtime|Controller|Adapter|Store|Provider)(?:$|[\s`.,:?!])/u

const TECHNOLOGY_OVERVIEW_SHAPE =
  /(?:\btech(?:nology|nologies)?\b|\btech[\s-]*stack\b|\bstack\b|технолог|техстек|стек\s+технолог|на\s+ч[её]м\s+напис|на\s+каких.+напис|из\s+чего.+сделан)/u

const DIRECT_EXECUTION_REQUEST_SHAPE =
  /(?:^|[\s,])(?:выполни|запусти|вызови|введи|исполни)(?:$|[\s,])|\b(?:run|execute|launch|invoke)\b/u

const POLITE_EXECUTION_REQUEST_SHAPE =
  /мож(?:ешь|ете)[^.!?]{0,120}(?:выполнить|запустить|вызвать|ввести|исполнить)|\b(?:can|could|would)\s+you\b[^.!?]{0,120}\b(?:run|execute|launch|invoke)\b/u

const BROWSER_EXECUTION_REQUEST_SHAPE =
  /(?:^|[\s,])(?:открой|перейди|нажми|кликни|выбери|заполни|прокрути|переключи)(?:$|[\s,:])|мож(?:ешь|ете)[^.!?]{0,180}(?:открыть|перейти|нажать|кликнуть|выбрать|заполнить|прокрутить|переключить)|^(?:please\s+)?(?:open|visit|navigate|click|press|select|fill|scroll|switch)\b|\b(?:can|could|would)\s+you\b[^.!?]{0,180}\b(?:open|visit|navigate|click|press|select|fill|scroll|switch)\b/u

const TERMINAL_INSPECTION_REQUEST_SHAPE =
  /(?:проверь|узнай)[^.!?]{0,120}(?:терминал|powershell|shell|команд)|(?:терминал|powershell|shell|команд)[^.!?]{0,120}(?:проверь|узнай)|\b(?:check|find out)\b[^.!?]{0,120}\b(?:terminal|shell|command)\b|\b(?:terminal|shell|command)\b[^.!?]{0,120}\b(?:check|find out)\b/u

const SOURCE_INSPECTION_REQUEST_SHAPE =
  /(?:посмотри|прочитай|изучи|открой)[^.!?]{0,120}[\w./\\-]+\.[a-z0-9]+|\b(?:inspect|read|open)\b[^.!?]{0,120}[\w./\\-]+\.[a-z0-9]+/u

function hasSourceFileReference(userText: string): boolean {
  for (const match of userText.matchAll(SOURCE_FILE_SHAPE)) {
    const token = match[1]
    const extension = token.split('.').at(-1)?.toLowerCase()
    const basename =
      token
        .split(/[\\/]/u)
        .at(-1)
        ?.slice(0, -(extension?.length ?? 0) - 1) ?? ''
    const pathQualified = token.includes('/') || token.includes('\\')
    const sourceLikeCasing =
      basename === basename.toLowerCase() || basename === basename.toUpperCase()
    if (pathQualified || extension !== 'js' || sourceLikeCasing) return true
  }
  return false
}

function isExplicitActionRequest(normalized: string): boolean {
  return (
    DIRECT_EXECUTION_REQUEST_SHAPE.test(normalized) ||
    POLITE_EXECUTION_REQUEST_SHAPE.test(normalized) ||
    BROWSER_EXECUTION_REQUEST_SHAPE.test(normalized) ||
    TERMINAL_INSPECTION_REQUEST_SHAPE.test(normalized)
  )
}

export function projectContextRequirement(userText: string): ProjectContextRequirement {
  const normalized = userText.normalize('NFKC').toLowerCase()
  if (EXPLICIT_PROJECT_SCOPE_SHAPE.test(normalized) || TECHNICAL_SYMBOL_SHAPE.test(userText)) {
    return 'required'
  }
  const sourceFileReference = hasSourceFileReference(userText)
  if (isExplicitActionRequest(normalized)) {
    return sourceFileReference && SOURCE_INSPECTION_REQUEST_SHAPE.test(normalized)
      ? 'required'
      : 'none'
  }
  if (sourceFileReference) return 'required'
  if (PROJECT_KNOWLEDGE_SHAPE.test(normalized)) return 'required'
  if (OPTIONAL_PROJECT_TERMS.some((term) => normalized.includes(term))) return 'optional'
  return 'none'
}

export function isProjectRelevantRequest(userText: string): boolean {
  return projectContextRequirement(userText) !== 'none'
}

export function isProjectTechnologyOverviewRequest(userText: string): boolean {
  const normalized = userText.normalize('NFKC').toLowerCase()
  return isProjectRelevantRequest(userText) && TECHNOLOGY_OVERVIEW_SHAPE.test(normalized)
}
