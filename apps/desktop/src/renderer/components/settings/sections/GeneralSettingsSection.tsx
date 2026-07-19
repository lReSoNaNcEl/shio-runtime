import { Picker, PickerItem } from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }
import type * as React from 'react'

import { useTranslation } from '../../../localization/useTranslation'
import type { GeneralSettingsActions, GeneralSettingsState } from '../state/settingsContracts'

const fullWidth = style({ width: 'full' })

export function GeneralSettingsSection({
  state,
  actions,
}: {
  state: GeneralSettingsState
  actions: GeneralSettingsActions
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="settings-grid">
      <Picker
        label={t('settings.language')}
        selectedKey={state.uiLocale}
        onSelectionChange={(key) => actions.setUiLocale(String(key) === 'en' ? 'en' : 'ru')}
        styles={fullWidth}
      >
        <PickerItem id="ru">{t('settings.language.ru')}</PickerItem>
        <PickerItem id="en">{t('settings.language.en')}</PickerItem>
      </Picker>
    </div>
  )
}
