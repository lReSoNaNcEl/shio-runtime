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
]

const TECHNICAL_SHAPE =
  /(?:^|[\s`])(?:[\w.-]+\.(?:ts|tsx|js|py|md|json)|[A-Z][A-Za-z0-9]*(?:Runtime|Controller|Adapter|Store|Provider))(?:$|[\s`.,:?!])/u

export function isProjectRelevantRequest(userText: string): boolean {
  const normalized = userText.normalize('NFKC').toLowerCase()
  if (PROJECT_TERMS.some((term) => normalized.includes(term))) return true
  return TECHNICAL_SHAPE.test(userText)
}
