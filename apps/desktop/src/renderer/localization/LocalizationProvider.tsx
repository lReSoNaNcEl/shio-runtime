import { type ReactNode, useEffect, useMemo, useState } from 'react'

import {
  DEFAULT_UI_LOCALE,
  normalizeUiLocale,
  toIntlLocale,
  translate,
  type UiLocale,
} from '../../shared/localization'
import { observeRendererPromise } from '../reliability/observePromise'
import { LocalizationContext, type LocalizationContextValue } from './localizationContext'

export { LocalizationContext, type LocalizationContextValue } from './localizationContext'

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<UiLocale>(DEFAULT_UI_LOCALE)

  useEffect(() => {
    let active = true
    const isOverlay = new URLSearchParams(window.location.search).get('overlay') === '1'
    const configApi = isOverlay ? window.overlayApi.config : window.api.config
    observeRendererPromise(
      configApi.get().then((config) => {
        if (active) setLocale(normalizeUiLocale(config.uiLocale))
      }),
      'load UI locale',
    )
    const unsubscribe = configApi.onUpdated((config) => {
      if (active) setLocale(normalizeUiLocale(config.uiLocale))
    })
    return () => {
      active = false
      unsubscribe()
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
