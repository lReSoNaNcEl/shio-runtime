import { join } from 'node:path'

import electronLog from 'electron-log/main'

type ConsoleMethod = 'debug' | 'error' | 'info' | 'log' | 'warn'

const ignoredWriteErrors = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'])

let initialized = false
const recentErrors: SafeRuntimeError[] = []

export interface SafeRuntimeError {
  timestamp: string
  message: string
}

const originalConsole: Record<ConsoleMethod, (...args: unknown[]) => void> = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
}

function isIgnoredWriteError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && ignoredWriteErrors.has(code)
}

function swallowClosedPipe(error: unknown): void {
  if (isIgnoredWriteError(error)) return
  throw error
}

function attachStreamGuard(stream: NodeJS.WriteStream | undefined): void {
  stream?.on('error', swallowClosedPipe)
}

function write(method: ConsoleMethod, args: unknown[]): void {
  const safeArgs = args.map((value) => sanitize(value))
  try {
    if (initialized) {
      const level = method === 'log' ? 'info' : method
      electronLog[level](...safeArgs)
      if (method === 'error') {
        recentErrors.push({
          timestamp: new Date().toISOString(),
          message: safeArgs.map(formatValue).join(' ').slice(0, 2_000),
        })
        if (recentErrors.length > 20) recentErrors.shift()
      }
      return
    }
    originalConsole[method](...safeArgs)
  } catch (error) {
    swallowClosedPipe(error)
  }
}

export function initializeSafeLogging(logsDirectory: string, development: boolean): void {
  if (initialized) return

  attachStreamGuard(process.stdout)
  attachStreamGuard(process.stderr)
  electronLog.transports.file.resolvePathFn = () => join(logsDirectory, 'main.log')
  electronLog.transports.file.maxSize = 5 * 1024 * 1024
  electronLog.transports.file.level = 'info'
  electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
  electronLog.transports.console.level = development ? 'debug' : false
  electronLog.initialize()
  initialized = true

  for (const method of Object.keys(originalConsole) as ConsoleMethod[]) {
    console[method] = (...args: unknown[]) => {
      try {
        originalConsole[method](...args.map((value) => sanitize(value)))
      } catch (error) {
        swallowClosedPipe(error)
      }
    }
  }
  mainLog.info('Persistent logging initialized')
}

export function getRecentSafeErrors(): readonly SafeRuntimeError[] {
  return [...recentErrors]
}

export const mainLog = {
  debug: (...args: unknown[]) => write('debug', args),
  error: (...args: unknown[]) => write('error', args),
  info: (...args: unknown[]) => write('info', args),
  log: (...args: unknown[]) => write('log', args),
  warn: (...args: unknown[]) => write('warn', args),
}

const SENSITIVE_KEY = /api.?key|authorization|bearer|token|credential|secret|cipher|encrypted/i
const SECRET_VALUE =
  /\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/gi

function sanitize(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    return value
      .replace(SECRET_VALUE, '[REDACTED]')
      .replace(
        /((?:api.?key|authorization|token|credential|secret)\s*[:=]\s*)\S+/gi,
        '$1[REDACTED]',
      )
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitize(value.message),
      stack: sanitize(value.stack ?? ''),
    }
  }
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const byteLength =
      value instanceof ArrayBuffer ? value.byteLength : (value as ArrayBufferView).byteLength
    return `[binary ${byteLength} bytes omitted]`
  }
  if (!value || typeof value !== 'object' || depth >= 5) return value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, '', depth + 1))
  const keys = Object.keys(value)
  if (keys.includes('pythonSpeechUrl') && keys.includes('llm') && keys.includes('uiLocale')) {
    return '[application config omitted]'
  }
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitize(entryValue, entryKey, depth + 1),
    ]),
  )
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
