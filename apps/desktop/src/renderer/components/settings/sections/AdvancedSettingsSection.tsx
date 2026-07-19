import { Switch } from '@react-spectrum/s2'

import { useTranslation } from '../../../localization/useTranslation'
import {
  type AdvancedSettingsActions,
  type AdvancedSettingsState,
} from '../state/settingsContracts'

export function AdvancedSettingsSection({
  state,
  actions,
}: {
  state: AdvancedSettingsState
  actions: AdvancedSettingsActions
}) {
  const { t } = useTranslation()
  return (
    <div className="settings-grid">
      <section className="settings-switch-with-description">
        <h3>{t('settings.developerTools.title')}</h3>
        <Switch
          isSelected={state.developerModeEnabled}
          onChange={(enabled) => void actions.setDeveloperModeEnabled(enabled)}
        >
          {t('settings.developerMode.title')}
        </Switch>
        <span className="settings-hint">{t('settings.developerMode.description')}</span>
        {state.developerModeEnabled && (
          <>
            <Switch
              isSelected={state.developerOverlayAnimationHudEnabled}
              onChange={(enabled) => void actions.setDeveloperOverlayAnimationHudEnabled(enabled)}
            >
              {t('settings.developerAnimationHud.title')}
            </Switch>
            <span className="settings-hint">{t('settings.developerAnimationHud.description')}</span>
          </>
        )}
      </section>
    </div>
  )
}
