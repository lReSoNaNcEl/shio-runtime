import type { UiLocale } from './locale'
import { messages, type TranslationKey } from './messages'

export type TranslationParams = Readonly<Record<string, string | number>>
export type Translator = (key: TranslationKey, params?: TranslationParams) => string

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g

export function messagePlaceholders(message: string): string[] {
  return [...message.matchAll(PLACEHOLDER)].map((match) => match[1]).sort()
}

export function translate(
  locale: UiLocale,
  key: TranslationKey,
  params: TranslationParams = {},
): string {
  return messages[locale][key].replace(PLACEHOLDER, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  )
}
