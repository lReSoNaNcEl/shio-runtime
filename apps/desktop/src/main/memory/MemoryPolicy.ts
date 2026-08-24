import type { MemoryRuntimeStatus, MemoryToolRequest } from '../../shared/memory'

export class MemoryPolicyError extends Error {
  constructor(
    readonly code:
      | 'MEMORY_DISABLED'
      | 'MEMORY_UNAVAILABLE'
      | 'INVALID_REQUEST'
      | 'SENSITIVE_CONTENT'
      | 'NOT_FOUND'
      | 'NO_CHANGES',
    message: string,
  ) {
    super(message)
    this.name = 'MemoryPolicyError'
  }
}

const PEM_SECRET = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/iu
const LABELED_SECRET =
  /(?:password|passwd|парол(?:ь|я)|api[-_ ]?key|api[-_ ]?token|access[-_ ]?token|secret|2fa|totp|recovery[-_ ]?code|seed)\s*(?::|=|is|—|-)\s*["']?[A-Za-z0-9_+/=-]{8,}/iu
const KNOWN_TOKEN =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[opurs]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[A-Za-z0-9_-]{20,})\b/u
const RECOVERY_CODES = /\b(?:[A-Z0-9]{4}[- ]?){2,4}[A-Z0-9]{4}\b/u

export function containsSensitiveMemoryContent(text: string): boolean {
  return (
    PEM_SECRET.test(text) ||
    LABELED_SECRET.test(text) ||
    KNOWN_TOKEN.test(text) ||
    RECOVERY_CODES.test(text)
  )
}

export interface MemoryPolicyContext {
  sourceTurnId: string
  status: MemoryRuntimeStatus
  exists(id: string): boolean
}

export class MemoryPolicy {
  validate(request: MemoryToolRequest, context: MemoryPolicyContext): void {
    if (!context.sourceTurnId.trim() || context.sourceTurnId.length > 200) {
      throw new MemoryPolicyError('INVALID_REQUEST', 'The current Memory turn id is invalid.')
    }
    if (!context.status.operational) {
      throw new MemoryPolicyError('MEMORY_UNAVAILABLE', 'Long-term memory is unavailable.')
    }
    if (!context.status.enabled) {
      throw new MemoryPolicyError('MEMORY_DISABLED', 'Long-term memory is disabled.')
    }

    if (request.name === 'memory.store') {
      for (const candidate of request.input.memories) {
        if (containsSensitiveMemoryContent(candidate.text)) {
          throw new MemoryPolicyError(
            'SENSITIVE_CONTENT',
            'The requested memory was not stored because it appears to contain a credential or secret.',
          )
        }
      }
    }

    if (request.name === 'memory.update') {
      if (!context.exists(request.input.id)) {
        throw new MemoryPolicyError('NOT_FOUND', 'The referenced memory does not exist.')
      }
      if (request.input.text && containsSensitiveMemoryContent(request.input.text)) {
        throw new MemoryPolicyError(
          'SENSITIVE_CONTENT',
          'The requested memory was not updated because it appears to contain a credential or secret.',
        )
      }
    }

    if (request.name === 'memory.forget') {
      if (request.input.ids.some((id) => !context.exists(id))) {
        throw new MemoryPolicyError('NOT_FOUND', 'At least one referenced memory does not exist.')
      }
    }
  }
}
