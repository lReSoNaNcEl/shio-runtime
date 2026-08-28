import type { z } from 'zod'

export interface StructuredModelResponseDiagnostic {
  expectedSchema: string
  issues: readonly {
    path: readonly string[]
    code: string
  }[]
}

export class StructuredModelResponseParseError extends Error {
  constructor(
    readonly code: 'COMPUTER_USE_MODEL_INVALID_RESPONSE' | 'COMPUTER_USE_MODEL_SCHEMA_MISMATCH',
    readonly diagnostic: StructuredModelResponseDiagnostic,
  ) {
    super(code)
    this.name = 'StructuredModelResponseParseError'
  }
}

/**
 * Strictly decodes one model object without treating model prose as executable data.
 * It deliberately accepts only a raw object or one complete ```json fenced object.
 */
export class StructuredModelResponseParser<T> {
  constructor(
    private readonly schema: z.ZodType<T>,
    private readonly expectedSchema: string,
  ) {}

  parse(response: string): T {
    const parsed = parseOneJsonObject(response)
    if (parsed === undefined) {
      throw new StructuredModelResponseParseError('COMPUTER_USE_MODEL_INVALID_RESPONSE', {
        expectedSchema: this.expectedSchema,
        issues: [],
      })
    }
    const validated = this.schema.safeParse(parsed)
    if (validated.success) return validated.data
    throw new StructuredModelResponseParseError('COMPUTER_USE_MODEL_SCHEMA_MISMATCH', {
      expectedSchema: this.expectedSchema,
      issues: validated.error.issues.slice(0, 12).map((issue) => ({
        path: issue.path.slice(0, 8).map(String),
        code: issue.code,
      })),
    })
  }
}

function parseOneJsonObject(response: string): Record<string, unknown> | undefined {
  const trimmed = response.trim()
  const fenced = trimmed.match(/^```json[\t ]*\r?\n([\s\S]*?)\r?\n?```$/iu)
  const candidate = fenced?.[1] ?? trimmed
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return undefined
  try {
    const value: unknown = JSON.parse(candidate)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function isStructuredModelResponseError(
  error: unknown,
): error is StructuredModelResponseParseError {
  return error instanceof StructuredModelResponseParseError
}
