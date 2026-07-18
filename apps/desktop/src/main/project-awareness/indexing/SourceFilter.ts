import { extname, posix } from 'node:path'

import type { ProjectLanguage } from '../../../shared/projectAwareness'
import type { ProjectTreeEntry } from '../contracts'

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, ProjectLanguage>> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.md': 'markdown',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
}

const DENIED_DIRECTORY_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  'runtime-debug',
])

const DENIED_EXTENSIONS = new Set([
  '.lock',
  '.vrm',
  '.vrma',
  '.glb',
  '.gltf',
  '.png',
  '.jpg',
  '.jpeg',
  '.wav',
  '.mp3',
])

const CANONICAL_PRIORITY: Readonly<Record<string, number>> = {
  'ARCHITECTURE.md': 1000,
  'AGENTS.md': 950,
  'README.md': 850,
  'package.json': 800,
}

export function projectLanguageForPath(path: string): ProjectLanguage | null {
  return LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()] ?? null
}

export function sourcePriority(path: string): number {
  const base = posix.basename(path)
  if (CANONICAL_PRIORITY[base]) return CANONICAL_PRIORITY[base]
  if (/^tsconfig(?:\..+)?\.json$/i.test(base)) return 780
  if (/(?:^|\/)(?:contracts?|runtime)(?:\/|$)/i.test(path)) return 700
  return 100
}

export function isAllowedProjectPath(
  entry: Pick<ProjectTreeEntry, 'path' | 'size'>,
  maxFileSizeBytes: number,
): boolean {
  const normalized = entry.path.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const base = segments.at(-1) ?? ''
  const lowerBase = base.toLowerCase()
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return false
  if (segments.some((segment) => DENIED_DIRECTORY_SEGMENTS.has(segment.toLowerCase()))) return false
  if (lowerBase === 'harness.cjs' || lowerBase.includes('.min.')) return false
  if (lowerBase === '.env' || lowerBase.startsWith('.env.')) return false
  if (/secret|credential|private[-_.]?key/i.test(normalized)) return false
  if (DENIED_EXTENSIONS.has(extname(lowerBase))) return false
  if (!projectLanguageForPath(normalized)) return false
  return entry.size >= 0 && entry.size <= maxFileSizeBytes
}

export function isSafeTextContent(content: string): boolean {
  if (content.includes('\0')) return false
  if (!content) return true
  const lines = content.split(/\r?\n/)
  const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const averageLine = content.length / Math.max(1, lines.length)
  return longestLine < 20_000 && !(lines.length < 5 && averageLine > 1_000)
}
