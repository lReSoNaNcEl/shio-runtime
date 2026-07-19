import { isAxiosError } from 'axios'
import { ZodError } from 'zod'

import type {
  SerializedSpeechError,
  SpeechOperation,
  SpeechServiceErrorCode,
} from '../../shared/speech'
import { mainLog } from '../logging/safeLogger'

/**
 * Main-side Speech Adapter error. Wraps an arbitrary external failure (axios,
 * WebSocket, Zod) as a normalized, serializable Speech-domain error. Only the
 * `SerializedSpeechError` fields cross the IPC boundary; the original cause is
 * kept for local logging only and is never sent to the renderer.
 */
export class SpeechServiceError extends Error implements SerializedSpeechError {
  readonly code: SpeechServiceErrorCode
  readonly operation: SpeechOperation
  readonly recoverable: boolean
  readonly technicalMessage?: string

  constructor(fields: SerializedSpeechError, cause?: unknown) {
    super(fields.technicalMessage ?? fields.code)
    this.name = 'SpeechServiceError'
    this.code = fields.code
    this.operation = fields.operation
    this.recoverable = fields.recoverable
    this.technicalMessage = fields.technicalMessage
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause
  }

  toSerialized(): SerializedSpeechError {
    return {
      code: this.code,
      operation: this.operation,
      recoverable: this.recoverable,
      technicalMessage: this.technicalMessage,
    }
  }
}

const RECOVERABLE: Record<SpeechServiceErrorCode, boolean> = {
  SERVICE_UNAVAILABLE: true,
  SERVICE_ERROR: true,
  REQUEST_TIMEOUT: true,
  REQUEST_REJECTED: false,
  RECOGNITION_FAILED: false,
  INVALID_RESPONSE: false,
  UNKNOWN: false,
}

const TRANSPORT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
])
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT'])

/**
 * Short, safe technical hint. We keep the transport error code and, when it is a
 * connection refusal, the host:port — but never headers, request bodies, auth,
 * stack traces, or filesystem paths. The full diagnostic stays in main logs.
 */
function sanitizeTechnicalMessage(raw: string): string {
  const firstLine = raw.split('\n')[0]?.trim() ?? raw
  const match = firstLine.match(/((?:connect\s+)?[A-Z]{3,}(?:\s+\d{1,3}(?:\.\d{1,3}){3}:\d+)?)/)
  return (match?.[1] ?? firstLine).slice(0, 120)
}

/** Classify an arbitrary external failure into the stable Speech Adapter contract. */
export function normalizeSpeechError(
  error: unknown,
  operation: SpeechOperation,
): SpeechServiceError {
  if (error instanceof SpeechServiceError) return error

  let code: SpeechServiceErrorCode = 'UNKNOWN'
  const rawMessage = error instanceof Error ? error.message : String(error)

  if (error instanceof ZodError) {
    code = 'INVALID_RESPONSE'
  } else if (isAxiosError(error)) {
    const status = error.response?.status
    const errCode = error.code
    if (typeof status === 'number') {
      code = status >= 500 ? 'SERVICE_ERROR' : status >= 400 ? 'REQUEST_REJECTED' : 'UNKNOWN'
    } else if (errCode && TIMEOUT_CODES.has(errCode)) {
      code = 'REQUEST_TIMEOUT'
    } else if (errCode && TRANSPORT_CODES.has(errCode)) {
      code = 'SERVICE_UNAVAILABLE'
    } else if (
      /fetch failed|socket hang up|network error/i.test(rawMessage) ||
      errCode === 'ERR_NETWORK'
    ) {
      code = 'SERVICE_UNAVAILABLE'
    } else {
      code = 'SERVICE_UNAVAILABLE'
    }
  } else if (error instanceof AggregateError) {
    code = 'SERVICE_UNAVAILABLE'
  } else if (
    /ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed|socket hang up|network error/i.test(rawMessage)
  ) {
    code = 'SERVICE_UNAVAILABLE'
  } else if (/ETIMEDOUT|ECONNABORTED|timeout/i.test(rawMessage)) {
    code = 'REQUEST_TIMEOUT'
  }

  return new SpeechServiceError(
    {
      code,
      operation,
      recoverable: RECOVERABLE[code],
      technicalMessage: sanitizeTechnicalMessage(rawMessage),
    },
    error,
  )
}

// ---- rate-limited logging (ТЗ §14) -----------------------------------------
// First failure of an (operation, code) pair logs at `error`; identical repeats
// log at `debug`; a recovery logs at `info`. The full raw cause is logged only
// on the first failure so retries never spam identical stack traces.
const activeFailures = new Set<string>()

export function logSpeechError(
  error: SerializedSpeechError,
  context: { attempt?: number; sessionId?: string; cause?: unknown } = {},
): void {
  const key = `${error.operation}:${error.code}`
  const record = {
    runtime: 'speech',
    adapter: 'local-speech-api',
    operation: error.operation,
    errorCode: error.code,
    technicalMessage: error.technicalMessage,
    timestamp: Date.now(),
    attempt: context.attempt,
    sessionId: context.sessionId,
  }
  if (activeFailures.has(key)) {
    mainLog.debug('[speech] repeated failure', record)
    return
  }
  activeFailures.add(key)
  mainLog.error('[speech] failure', record, context.cause ?? '')
}

export function logSpeechRecovery(operation: SpeechOperation): void {
  let cleared = false
  for (const key of [...activeFailures]) {
    if (key.startsWith(`${operation}:`)) {
      activeFailures.delete(key)
      cleared = true
    }
  }
  if (cleared) {
    mainLog.info('[speech] recovered', {
      runtime: 'speech',
      adapter: 'local-speech-api',
      operation,
      timestamp: Date.now(),
    })
  }
}
