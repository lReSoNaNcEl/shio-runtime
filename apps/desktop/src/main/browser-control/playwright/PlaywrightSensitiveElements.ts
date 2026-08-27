const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
])

const SENSITIVE_ATTRIBUTE_PATTERN =
  /(?:^|[-_])(?:token|secret|api[-_]?key|password|otp)(?:$|[-_])/iu

const UNSAFE_PLACEHOLDER_PATTERN =
  /(?:\b\d[ -]?){12,}\b|\b[A-Za-z0-9_-]{24,}\b|(?:sk|pk|api)[-_][A-Za-z0-9_-]{12,}/u

export const SENSITIVE_ELEMENT_SELECTOR = [
  'input[type="password"]',
  ...[...SENSITIVE_AUTOCOMPLETE].map((value) => `[autocomplete="${value}" i]`),
  ...['input', 'textarea'].flatMap((tag) =>
    ['token', 'secret', 'api-key', 'api_key', 'password', 'otp'].flatMap((term) => [
      `${tag}[name*="${term}" i]`,
      `${tag}[id*="${term}" i]`,
    ]),
  ),
].join(',')

export interface SensitiveElementMetadata {
  inputType: string
  autocomplete: string
  nameAttribute: string
  idAttribute: string
}

export function isSensitiveElement(metadata: SensitiveElementMetadata): boolean {
  return (
    metadata.inputType === 'password' ||
    SENSITIVE_AUTOCOMPLETE.has(metadata.autocomplete) ||
    SENSITIVE_ATTRIBUTE_PATTERN.test(metadata.nameAttribute) ||
    SENSITIVE_ATTRIBUTE_PATTERN.test(metadata.idAttribute)
  )
}

export function safeSensitivePlaceholder(value: string | undefined): string | undefined {
  const placeholder = value?.normalize('NFKC').trim().replace(/\s+/gu, ' ').slice(0, 500)
  if (!placeholder || UNSAFE_PLACEHOLDER_PATTERN.test(placeholder)) return undefined
  return placeholder
}

export function redactSensitiveValues(value: string, sensitiveValues: readonly string[]): string {
  let redacted = value
  for (const sensitiveValue of sensitiveValues) {
    if (!sensitiveValue) continue
    redacted = redacted.split(sensitiveValue).join('[REDACTED]')
  }
  return redacted
}
