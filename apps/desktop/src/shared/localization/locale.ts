export type UiLocale = 'ru' | 'en'

export const DEFAULT_UI_LOCALE: UiLocale = 'ru'

export function isUiLocale(value: unknown): value is UiLocale {
  return value === 'ru' || value === 'en'
}

export function normalizeUiLocale(value: unknown): UiLocale {
  return isUiLocale(value) ? value : DEFAULT_UI_LOCALE
}

export function toIntlLocale(locale: UiLocale): 'ru-RU' | 'en-US' {
  return locale === 'ru' ? 'ru-RU' : 'en-US'
}
