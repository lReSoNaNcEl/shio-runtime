import { createContext } from 'react'

import type { TranslationKey, TranslationParams, UiLocale } from '../../shared/localization'

export interface LocalizationContextValue {
  locale: UiLocale
  intlLocale: 'ru-RU' | 'en-US'
  t: (key: TranslationKey, params?: TranslationParams) => string
}

export const LocalizationContext = createContext<LocalizationContextValue | null>(null)
