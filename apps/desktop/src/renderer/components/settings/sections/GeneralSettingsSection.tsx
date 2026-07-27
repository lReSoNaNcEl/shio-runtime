import { Button, Heading, Picker, PickerItem, Text } from '@react-spectrum/s2'
import Settings from '@react-spectrum/s2/icons/Settings'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import { useTranslation } from '../../../localization/useTranslation'
import { type GeneralSettingsActions, type GeneralSettingsState } from '../state/settingsContracts'

const fullWidth = style({ width: 'full' })

export function GeneralSettingsSection({
  state,
  actions,
}: {
  state: GeneralSettingsState
  actions: GeneralSettingsActions
}) {
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
      <section className="settings-action-panel" aria-labelledby="general-setup-title">
        <div className="settings-action-panel-copy">
          <Heading id="general-setup-title" level={3}>
            {t('settings.general.setup.title')}
          </Heading>
          <Text UNSAFE_className="settings-hint">{t('settings.general.setup.description')}</Text>
        </div>
        <Button
          variant="secondary"
          fillStyle="outline"
          size="M"
          onPress={() => window.dispatchEvent(new Event('shio:open-setup'))}
        >
          <Settings />
          <Text>{t('settings.general.setup.action')}</Text>
        </Button>
      </section>
    </div>
  )
}
