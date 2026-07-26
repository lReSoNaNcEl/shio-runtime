import type { SpeechTextNormalizationCategory } from './types'

export interface TechnicalPronunciation {
  id: string
  input: string
  spokenRu: string
  category: Extract<SpeechTextNormalizationCategory, 'technical-term' | 'abbreviation'>
}

const TERMS: readonly TechnicalPronunciation[] = [
  {
    id: 'term.gpt-5.6',
    input: 'GPT-5.6',
    spokenRu: 'джи-пи-ти пять точка шесть',
    category: 'technical-term',
  },
  {
    id: 'term.gpt-5',
    input: 'GPT-5',
    spokenRu: 'джи-пи-ти пять',
    category: 'technical-term',
  },
  {
    id: 'term.typescript',
    input: 'TypeScript',
    spokenRu: 'тайпскрипт',
    category: 'technical-term',
  },
  {
    id: 'term.websocket',
    input: 'WebSocket',
    spokenRu: 'веб-сокет',
    category: 'technical-term',
  },
  {
    id: 'term.localhost',
    input: 'localhost',
    spokenRu: 'локалхост',
    category: 'technical-term',
  },
  {
    id: 'term.nodejs',
    input: 'Node.js',
    spokenRu: 'ноуд джи-эс',
    category: 'technical-term',
  },
  {
    id: 'term.github',
    input: 'GitHub',
    spokenRu: 'гитхаб',
    category: 'technical-term',
  },
  {
    id: 'term.electron',
    input: 'Electron',
    spokenRu: 'электрон',
    category: 'technical-term',
  },
  {
    id: 'term.react',
    input: 'React',
    spokenRu: 'реакт',
    category: 'technical-term',
  },
  {
    id: 'term.python',
    input: 'Python',
    spokenRu: 'пайтон',
    category: 'technical-term',
  },
  {
    id: 'term.vrma',
    input: 'VRMA',
    spokenRu: 'ви-ар-эм-эй',
    category: 'abbreviation',
  },
  {
    id: 'term.vrm',
    input: 'VRM',
    spokenRu: 'ви-ар-эм',
    category: 'abbreviation',
  },
  {
    id: 'term.https',
    input: 'HTTPS',
    spokenRu: 'эйч-ти-ти-пи-эс',
    category: 'abbreviation',
  },
  {
    id: 'term.http',
    input: 'HTTP',
    spokenRu: 'эйч-ти-ти-пи',
    category: 'abbreviation',
  },
  { id: 'term.api', input: 'API', spokenRu: 'эй-пи-ай', category: 'abbreviation' },
  { id: 'term.tts', input: 'TTS', spokenRu: 'ти-ти-эс', category: 'abbreviation' },
  { id: 'term.asr', input: 'ASR', spokenRu: 'эй-эс-ар', category: 'abbreviation' },
  { id: 'term.llm', input: 'LLM', spokenRu: 'эл-эл-эм', category: 'abbreviation' },
  { id: 'term.json', input: 'JSON', spokenRu: 'джейсон', category: 'abbreviation' },
  { id: 'term.cuda', input: 'CUDA', spokenRu: 'куда', category: 'abbreviation' },
  { id: 'term.npm', input: 'npm', spokenRu: 'эн-пи-эм', category: 'abbreviation' },
] as const

const EXACT_SEGMENTS: Readonly<Record<string, string>> = {
  apps: 'эппс',
  api: 'эй-пи-ай',
  src: 'эс-эр-си',
  main: 'мэйн',
  desktop: 'десктоп',
  app: 'эпп',
  routes: 'раутс',
  synthesize: 'синтесайз',
  launcher: 'лончер',
  release: 'релиз',
  manifest: 'манифест',
  health: 'хэлс',
  users: 'юзерс',
  web: 'веб',
  project: 'проджект',
  conversationruntime: 'конверзейшен рантайм',
  runtime: 'рантайм',
  code: 'код',
  file: 'файл',
  sol: 'сол',
  ts: 'ти-эс',
  js: 'джи-эс',
  json: 'джейсон',
  py: 'пи-вай',
  md: 'эм-ди',
}

export function applyTechnicalPronunciations(
  text: string,
  language: string,
): {
  text: string
  rules: TechnicalPronunciation[]
} {
  if (!language.toLowerCase().startsWith('ru')) return { text, rules: [] }

  let output = text
  const rules: TechnicalPronunciation[] = []
  for (const term of TERMS) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(term.input)}(?![\\p{L}\\p{N}_])`,
      'giu',
    )
    if (!pattern.test(output)) continue
    pattern.lastIndex = 0
    output = output.replace(pattern, term.spokenRu)
    rules.push(term)
  }
  return { text: output, rules }
}

export function pronounceKnownSegment(segment: string, language: string): string | null {
  if (!language.toLowerCase().startsWith('ru')) return null
  return EXACT_SEGMENTS[segment.toLowerCase()] ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
