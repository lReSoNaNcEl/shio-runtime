import { useState } from 'react'

import type { UiLocale } from '../../../../shared/localization'

export function useGeneralSettings() {
  const [uiLocale, setUiLocale] = useState<UiLocale>('ru')
  return { uiLocale, setUiLocale }
}
