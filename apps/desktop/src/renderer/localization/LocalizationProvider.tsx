import type * as React from 'react'
import { createContext, useEffect, useMemo, useState } from 'react'

import { type TranslationParams, translate } from '../../shared/localization/format'
import {
  DEFAULT_UI_LOCALE,
  normalizeUiLocale,
  toIntlLocale,
  type UiLocale,
} from '../../shared/localization/locale'
import type { TranslationKey } from '../../shared/localization/messages'

export interface LocalizationContextValue {
  locale: UiLocale
  intlLocale: 'ru-RU' | 'en-US'
  t: (key: TranslationKey, params?: TranslationParams) => string
}

export const LocalizationContext = createContext<LocalizationContextValue | null>(null)

export function LocalizationProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [locale, setLocale] = useState<UiLocale>(DEFAULT_UI_LOCALE)

  useEffect(() => {
    let active = true
    void window.api.config.get().then((config) => {
      if (active) setLocale(normalizeUiLocale(config.uiLocale))
    })
    window.api.config.onUpdated((config) => {
      if (active) setLocale(normalizeUiLocale(config.uiLocale))
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<LocalizationContextValue>(
    () => ({
      locale,
      intlLocale: toIntlLocale(locale),
      t: (key, params) => translate(locale, key, params),
    }),
    [locale],
  )

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>
}
