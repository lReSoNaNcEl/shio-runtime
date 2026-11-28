import { ActionButton, Heading, Switch, Text } from '@react-spectrum/s2'
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen'

import { useTranslation } from '../../../localization/useTranslation'
import { observeRendererPromise } from '../../../reliability/observePromise'
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
    <div className="developer-settings-stack">
      <section className="developer-settings-panel" aria-labelledby="developer-mode-title">
        <div className="developer-settings-copy">
          <Heading id="developer-mode-title" level={3}>
            {t('settings.developerTools.title')}
          </Heading>
          <Text UNSAFE_className="settings-hint">{t('settings.developerMode.description')}</Text>
        </div>
        <Switch
          isSelected={state.developerModeEnabled}
          onChange={(enabled) =>
            observeRendererPromise(
              actions.setDeveloperModeEnabled(enabled),
              'toggle developer mode',
            )
          }
        >
          {t('settings.developerMode.title')}
        </Switch>
      </section>

      {state.developerModeEnabled && (
        <section className="developer-settings-panel" aria-labelledby="developer-runtime-title">
          <div className="developer-settings-copy">
            <Heading id="developer-runtime-title" level={3}>
              {t('settings.developerRuntime.title')}
            </Heading>
            <Text UNSAFE_className="settings-hint">
              {t('settings.developerRuntime.description')}
            </Text>
          </div>
          <div className="developer-settings-fields">
            <div className="developer-setting">
              <Switch
                isSelected={state.developerOverlayAnimationHudEnabled}
                onChange={(enabled) =>
                  observeRendererPromise(
                    actions.setDeveloperOverlayAnimationHudEnabled(enabled),
                    'toggle Overlay animation HUD',
                  )
                }
              >
                {t('settings.developerAnimationHud.title')}
              </Switch>
              <Text UNSAFE_className="settings-hint">
                {t('settings.developerAnimationHud.description')}
              </Text>
            </div>
            <div className="settings-compact-actions">
              <ActionButton
                onPress={() =>
                  observeRendererPromise(
                    window.api.system.openLogsFolder(),
                    'open Desktop logs folder',
                  )
                }
              >
                <FolderOpen />
                <Text>{t('settings.developer.logsFolder')}</Text>
              </ActionButton>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
