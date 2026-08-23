const PROJECT_TERMS = [
  'shio runtime',
  'project',
  'repository',
  'github',
  'commit',
  'branch',
  'runtime',
  'architecture',
  'code',
  'source',
  'file',
  'class',
  'function',
  'typescript',
  'python',
  'backend',
  'speech api',
  'tts',
  'asr',
  'f5-tts',
  'electron',
  'renderer',
  'adapter',
  'memory layer',
  'character state',
  'action runtime',
  'avatar runtime',
  'speech runtime',
  'conversation runtime',
  'project awareness',
  'проект',
  'репозитор',
  'гитхаб',
  'коммит',
  'ветк',
  'код',
  'исходник',
  'файл',
  'класс',
  'функци',
  'архитектур',
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

const TECHNICAL_SHAPE =
  /(?:^|[\s`])(?:[\w.-]+\.(?:ts|tsx|js|py|md|json)|[A-Z][A-Za-z0-9]*(?:Runtime|Controller|Adapter|Store|Provider))(?:$|[\s`.,:?!])/u

const TECHNOLOGY_OVERVIEW_SHAPE =
  /(?:\btech(?:nology|nologies)?\b|\btech[\s-]*stack\b|\bstack\b|технолог|техстек|стек\s+технолог|на\s+ч[её]м\s+напис|на\s+каких.+напис|из\s+чего.+сделан)/u

export function isProjectRelevantRequest(userText: string): boolean {
  const normalized = userText.normalize('NFKC').toLowerCase()
  if (PROJECT_TERMS.some((term) => normalized.includes(term))) return true
  return TECHNICAL_SHAPE.test(userText)
}

export function isProjectTechnologyOverviewRequest(userText: string): boolean {
  const normalized = userText.normalize('NFKC').toLowerCase()
  return isProjectRelevantRequest(userText) && TECHNOLOGY_OVERVIEW_SHAPE.test(normalized)
}
