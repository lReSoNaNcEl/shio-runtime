import type { LlmProviderId, ModelFetchErrorKind } from '../../shared/llmProviders'

export type { ModelFetchErrorKind }

export class ModelFetchError extends Error {
  kind: ModelFetchErrorKind

  constructor(kind: ModelFetchErrorKind, message: string) {
    super(message)
    this.kind = kind
    this.name = 'ModelFetchError'
  }
}

export class LlmResponseError extends Error {
  provider: LlmProviderId
  rawResponse: unknown

  constructor(params: { provider: LlmProviderId; message: string; rawResponse?: unknown }) {
    super(params.message)
    this.name = 'LlmResponseError'
    this.provider = params.provider
    this.rawResponse = params.rawResponse
  }
}

export class LlmCapabilityError extends Error {
  readonly code = 'VISION_UNSUPPORTED'

  constructor(message = 'VISION_UNSUPPORTED') {
    super(message)
    this.name = 'LlmCapabilityError'
  }
}

export function normalizeHttpErrorMessage(displayName: string, status: number): string {
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
