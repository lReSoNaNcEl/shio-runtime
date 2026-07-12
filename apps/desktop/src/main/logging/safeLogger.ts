type ConsoleMethod = 'debug' | 'error' | 'info' | 'log' | 'warn'

const ignoredWriteErrors = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'])

let initialized = false

const originalConsole: Record<ConsoleMethod, (...args: unknown[]) => void> = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console)
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
  try {
    originalConsole[method](...args)
  } catch (error) {
    swallowClosedPipe(error)
  }
}

export function initializeSafeLogging(): void {
  if (initialized) return
  initialized = true

  attachStreamGuard(process.stdout)
  attachStreamGuard(process.stderr)

  for (const method of Object.keys(originalConsole) as ConsoleMethod[]) {
    console[method] = (...args: unknown[]) => write(method, args)
  }
}

export const mainLog = {
  debug: (...args: unknown[]) => write('debug', args),
  error: (...args: unknown[]) => write('error', args),
  info: (...args: unknown[]) => write('info', args),
  log: (...args: unknown[]) => write('log', args),
  warn: (...args: unknown[]) => write('warn', args)
}
