import { useContext } from 'react'

import { LocalizationContext, type LocalizationContextValue } from './localizationContext'

export function useTranslation(): LocalizationContextValue {
  const value = useContext(LocalizationContext)
  if (!value) throw new Error('useTranslation must be used within LocalizationProvider')
  return value
}
