import type {
  LlmProviderId,
  LlmResponseFailure,
  LlmTurnErrorCode,
  ModelFetchErrorKind,
} from '../../shared/llm'

export type { ModelFetchErrorKind }

export class ModelFetchError extends Error {
  kind: ModelFetchErrorKind

  constructor(kind: ModelFetchErrorKind, message: string) {
    super(message)
    this.kind = kind
    this.name = 'ModelFetchError'
  }
}

export class LlmResponseError extends Error implements LlmResponseFailure {
  readonly providerId: LlmProviderId
  readonly code: LlmTurnErrorCode
  readonly recoverable: boolean
  readonly technicalMessage?: string

  constructor(params: {
    provider: LlmProviderId
    code?: LlmTurnErrorCode
    recoverable?: boolean
    message: string
    technicalMessage?: string
    rawResponse?: unknown
  }) {
    super(params.message)
    this.name = 'LlmResponseError'
    this.providerId = params.provider
    this.code = params.code ?? 'PROVIDER_REJECTED'
    this.recoverable = params.recoverable ?? false
    this.technicalMessage = params.technicalMessage ?? params.message
  }
}

export class LlmCapabilityError extends Error {
  readonly code = 'VISION_UNSUPPORTED'

  constructor(message = 'VISION_UNSUPPORTED') {
    super(message)
    this.name = 'LlmCapabilityError'
  }
}

export class LlmCredentialMissingError extends Error {
  readonly code = 'LLM_CREDENTIAL_MISSING'
  readonly recoverable = true
  readonly technicalMessage = 'Active LLM provider credential is missing'

  constructor() {
    super('LLM_CREDENTIAL_MISSING')
    this.name = 'LlmCredentialMissingError'
  }
}

export class LlmTurnCancelledError extends Error {
  readonly code = 'CANCELLED'
  readonly recoverable = true
  readonly technicalMessage = 'LLM turn cancelled'

  constructor() {
    super('CANCELLED')
    this.name = 'LlmTurnCancelledError'
  }
}

function providerErrorCode(responseData: unknown): string | undefined {
  if (!responseData || typeof responseData !== 'object' || Array.isArray(responseData)) {
    return undefined
  }
  const root = responseData as Record<string, unknown>
  const error = root.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined
  const code = (error as Record<string, unknown>).code
  return typeof code === 'string' ? code.trim().toLowerCase() : undefined
}

function isRateLimitFailure(status: number, responseData?: unknown): boolean {
  return (
    status === 429 || (status === 413 && providerErrorCode(responseData) === 'rate_limit_exceeded')
  )
}

export function normalizeHttpErrorMessage(
  displayName: string,
  status: number,
  responseData?: unknown,
): string {
  if (isRateLimitFailure(status, responseData)) {
    return `${displayName}: модель временно перегружена, попробуйте позже.`
  }
  switch (status) {
    case 400:
      return `${displayName}: некорректный запрос к модели.`
    case 401:
      return `${displayName}: аутентификация не пройдена. Проверьте API ключ.`
    case 403:
      return `${displayName}: доступ запрещён.`
    case 404:
      return `${displayName}: модель или эндпоинт не найдены.`
    case 408:
      return `${displayName}: превышено время ожидания ответа.`
    case 413:
      return `${displayName}: запрос слишком большой.`
    case 429:
      return `${displayName}: модель временно перегружена, попробуйте позже.`
    default:
      if (status >= 500) {
        return `${displayName}: временная ошибка на стороне провайдера.`
      }
      return `${displayName}: ошибка запроса (код ${status}).`
  }
}

export function networkErrorMessage(displayName: string): string {
  return `${displayName}: не удалось соединиться с провайдером (сетевая ошибка).`
}

export function classifyHttpFailure(
  status: number,
  responseData?: unknown,
): {
  code: LlmTurnErrorCode
  recoverable: boolean
} {
  if (isRateLimitFailure(status, responseData)) return { code: 'RATE_LIMITED', recoverable: true }
  if (status === 408 || status === 504) return { code: 'TIMEOUT', recoverable: true }
  if (status === 401) return { code: 'AUTH_ERROR', recoverable: false }
  if (status === 403) return { code: 'ACCESS_DENIED', recoverable: false }
  if (status === 413) return { code: 'REQUEST_TOO_LARGE', recoverable: false }
  if (status >= 500) return { code: 'PROVIDER_REJECTED', recoverable: true }
  return { code: 'PROVIDER_REJECTED', recoverable: false }
}
