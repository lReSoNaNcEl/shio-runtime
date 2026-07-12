import type { LlmProviderId } from '../../../shared/llmProviders'

export const PROVIDER_DISPLAY_NAMES: Record<LlmProviderId, string> = {
  groq: 'Groq',
  cerebras: 'Cerebras',
  github: 'GitHub Models',
  openrouter: 'OpenRouter',
  mistral: 'Mistral'
}

/**
 * Translate an HTTP status from any provider into a single readable Runtime
 * message. The UI never sees raw provider JSON or status codes buried in
 * bodies - only these normalized strings.
 */
export function normalizeHttpErrorMessage(providerId: LlmProviderId, status: number): string {
  const name = PROVIDER_DISPLAY_NAMES[providerId]
  switch (status) {
    case 400:
      return `${name}: \u043d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441 \u043a \u043c\u043e\u0434\u0435\u043b\u0438.`
    case 401:
      return `${name}: \u0430\u0443\u0442\u0435\u043d\u0442\u0438\u0444\u0438\u043a\u0430\u0446\u0438\u044f \u043d\u0435 \u043f\u0440\u043e\u0439\u0434\u0435\u043d\u0430. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 API \u043a\u043b\u044e\u0447.`
    case 403:
      return `${name}: \u0434\u043e\u0441\u0442\u0443\u043f \u0437\u0430\u043f\u0440\u0435\u0449\u0451\u043d.`
    case 404:
      return `${name}: \u043c\u043e\u0434\u0435\u043b\u044c \u0438\u043b\u0438 \u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.`
    case 408:
      return `${name}: \u043f\u0440\u0435\u0432\u044b\u0448\u0435\u043d\u043e \u0432\u0440\u0435\u043c\u044f \u043e\u0436\u0438\u0434\u0430\u043d\u0438\u044f \u043e\u0442\u0432\u0435\u0442\u0430.`
    case 413:
      return `${name}: \u0437\u0430\u043f\u0440\u043e\u0441 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0439.`
    case 429:
      return `${name}: \u043c\u043e\u0434\u0435\u043b\u044c \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043f\u0435\u0440\u0435\u0433\u0440\u0443\u0436\u0435\u043d\u0430, \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435.`
    default:
      if (status >= 500) return `${name}: \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u0430\u044f \u043e\u0448\u0438\u0431\u043a\u0430 \u043d\u0430 \u0441\u0442\u043e\u0440\u043e\u043d\u0435 \u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440\u0430.`
      return `${name}: \u043e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u043f\u0440\u043e\u0441\u0430 (\u043a\u043e\u0434 ${status}).`
  }
}

export function networkErrorMessage(providerId: LlmProviderId): string {
  return `${PROVIDER_DISPLAY_NAMES[providerId]}: \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0435\u0434\u0438\u043d\u0438\u0442\u044c\u0441\u044f \u0441 \u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440\u043e\u043c (\u0441\u0435\u0442\u0435\u0432\u0430\u044f \u043e\u0448\u0438\u0431\u043a\u0430).`
}
