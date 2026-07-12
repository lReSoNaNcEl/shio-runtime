import type { ModelFetchErrorKind } from '../../../shared/llmProviders'

export type { ModelFetchErrorKind }

export class ModelFetchError extends Error {
  kind: ModelFetchErrorKind

  constructor(kind: ModelFetchErrorKind, message: string) {
    super(message)
    this.kind = kind
    this.name = 'ModelFetchError'
  }
}
