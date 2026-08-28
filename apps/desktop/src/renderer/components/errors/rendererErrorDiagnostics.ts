import type { RendererFailureReport } from '../../../shared/system'

const MAX_ERROR_MESSAGE_LENGTH = 480
const MAX_COMPONENT_NAMES = 8
const SAFE_DIAGNOSTIC_NAME = /[^\p{L}\p{N}_.:$-]+/gu

export interface RendererFailureDetails extends RendererFailureReport {
  message: string
}

function normalizeDiagnosticName(value: unknown, fallback: string): string {
  const normalized = String(value ?? '')
    .replace(SAFE_DIAGNOSTIC_NAME, '')
    .slice(0, 80)
  return normalized || fallback
}

function createErrorId(): string {
  const bytes = new Uint8Array(4)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `RDR-${Date.now().toString(36).toUpperCase()}-${suffix.toUpperCase()}`
}

export function sanitizeRendererErrorMessage(message: unknown): string {
  const withoutControlCharacters = Array.from(String(message ?? ''), (character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 ? ' ' : character
  }).join('')
  return withoutControlCharacters
    .replace(
      /\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/gi,
      '[redacted]',
    )
    .replace(
      /((?:api.?key|authorization|token|credential|secret|password)\s*[:=]\s*)\S+/gi,
      '$1[redacted]',
    )
    .replace(/\b[A-Za-z]:\\[^\s"'<>]+/g, '[local path]')
    .replace(/\/(?:Users|home)\/[^\s"'<>]+/g, '[local path]')
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

export function extractRendererComponentNames(componentStack?: string | null): string[] {
  const names: string[] = []
  for (const line of componentStack?.split('\n') ?? []) {
    const match = /^\s*at\s+([\p{L}\p{N}_.:$-]+)/u.exec(line)
    if (!match) continue
    const name = normalizeDiagnosticName(match[1], '')
    if (!name || /^[a-z][a-z0-9-]*$/.test(name) || names.includes(name)) continue
    names.push(name)
    if (names.length === MAX_COMPONENT_NAMES) break
  }
  return names
}

export function createRendererFailureDetails(
  error: Error,
  componentStack?: string | null,
  errorId = createErrorId(),
): RendererFailureDetails {
  return {
    errorId,
    errorName: normalizeDiagnosticName(error.name, 'Error'),
    componentNames: extractRendererComponentNames(componentStack),
    message: sanitizeRendererErrorMessage(error.message),
  }
}
