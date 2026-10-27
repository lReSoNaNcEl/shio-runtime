import { Provider } from '@react-spectrum/s2'
import type { ReactNode } from 'react'

import { LocalizationContext } from '../../src/renderer/localization/LocalizationProvider'
import { toIntlLocale, translate, type UiLocale } from '../../src/shared/localization'

export function localizedWrapper(locale: UiLocale = 'en', theme: 'light' | 'dark' = 'light') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <LocalizationContext.Provider
        value={{
          locale,
          intlLocale: toIntlLocale(locale),
          t: (key, params) => translate(locale, key, params),
        }}
      >
        <Provider colorScheme={theme} locale={toIntlLocale(locale)}>
          {children}
        </Provider>
      </LocalizationContext.Provider>
    )
  }
}

export function stubWindowProperty(name: 'api' | 'overlayApi', value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(window, name)
  Object.defineProperty(window, name, { configurable: true, value })
  return () => {
    if (original) Object.defineProperty(window, name, original)
    else Reflect.deleteProperty(window, name)
  }
}
