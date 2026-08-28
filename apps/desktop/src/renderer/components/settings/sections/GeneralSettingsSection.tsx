import { Button, Heading, Picker, PickerItem, Switch, Text } from '@react-spectrum/s2'
import Settings from '@react-spectrum/s2/icons/Settings'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import { type UiTheme } from '../../../../shared/config'
import { useTranslation } from '../../../localization/useTranslation'
import { type GeneralSettingsActions, type GeneralSettingsState } from '../state/settingsContracts'

const fullWidth = style({ width: 'full' })

export function GeneralSettingsSection({
  state,
  actions,
  uiTheme,
  onThemeChange,
}: {
  state: GeneralSettingsState
  actions: GeneralSettingsActions
  uiTheme: UiTheme
  onThemeChange: (theme: UiTheme) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="settings-grid settings-general-grid">
      <Picker
        label={t('settings.language')}
        selectedKey={state.uiLocale}
        onSelectionChange={(key) => actions.setUiLocale(String(key) === 'en' ? 'en' : 'ru')}
        styles={fullWidth}
      >
        <PickerItem id="ru">{t('settings.language.ru')}</PickerItem>
        <PickerItem id="en">{t('settings.language.en')}</PickerItem>
      </Picker>
      <section className="settings-action-panel" aria-labelledby="general-theme-title">
        <div className="settings-action-panel-copy">
          <Heading id="general-theme-title" level={3}>
            {t('settings.general.theme.title')}
          </Heading>
          <Text UNSAFE_className="settings-hint">{t('settings.general.theme.description')}</Text>
        </div>
        <Switch
          size="S"
          isSelected={uiTheme === 'dark'}
          aria-label={t('app.theme.switch')}
          onChange={(selected) => onThemeChange(selected ? 'dark' : 'light')}
        >
          {t(uiTheme === 'dark' ? 'app.theme.dark' : 'app.theme.light')}
        </Switch>
      </section>
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
          UNSAFE_className="settings-open-setup-action"
          onPress={() => window.dispatchEvent(new Event('shio:open-setup'))}
        >
          <Settings />
          <Text>{t('settings.general.setup.action')}</Text>
        </Button>
      </section>
    </div>
  )
}
