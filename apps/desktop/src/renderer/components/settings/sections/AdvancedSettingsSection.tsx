import { ActionButton, Heading, Picker, PickerItem, Switch, Text } from '@react-spectrum/s2'
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import { type LlmProviderId } from '../../../../shared/llm'
import { useTranslation } from '../../../localization/useTranslation'
import { observeRendererPromise } from '../../../reliability/observePromise'
import { ModelComboBox } from '../ModelComboBox'
import {
  type AdvancedSettingsActions,
  type AdvancedSettingsState,
} from '../state/settingsContracts'

const fullWidth = style({ width: 'full' })

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
        <>
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

          <section
            className="developer-settings-panel"
            aria-labelledby="developer-arbitration-title"
          >
            <div className="developer-settings-copy">
              <Heading id="developer-arbitration-title" level={3}>
                {t('settings.llm.smart.title')}
              </Heading>
              <Text UNSAFE_className="settings-hint">{t('settings.llm.smart.description')}</Text>
            </div>
            <Switch
              isSelected={state.backlogRole.enabled}
              onChange={(enabled) => actions.setBacklogRole((value) => ({ ...value, enabled }))}
            >
              {t('settings.llm.smart.enable')}
            </Switch>
            {state.backlogRole.enabled && (
              <div className="developer-settings-fields">
                <Picker
                  label={t('common.provider')}
                  selectedKey={state.backlogRole.providerId || null}
                  onSelectionChange={(key) =>
                    actions.setBacklogRole((value) => ({
                      ...value,
                      providerId: String(key) as LlmProviderId,
                      model: '',
                    }))
                  }
                  styles={fullWidth}
                >
                  {state.providers
                    .filter(
                      (provider) => state.providerSettings[provider.id]?.credential.configured,
                    )
                    .map((provider) => (
                      <PickerItem key={provider.id} id={provider.id}>
                        {provider.displayName}
                      </PickerItem>
                    ))}
                </Picker>
                <ModelComboBox
                  label={t('common.model')}
                  models={state.backlogModels}
                  selectedId={state.backlogRole.model}
                  isDisabled={!state.backlogRole.providerId || state.backlogModels.length === 0}
                  placeholder={t('common.searchModel')}
                  onSelect={(id) => actions.setBacklogRole((value) => ({ ...value, model: id }))}
                />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
