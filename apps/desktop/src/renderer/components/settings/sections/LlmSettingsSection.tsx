import {
  ActionButton,
  Content,
  ContextualHelp,
  Divider,
  Heading,
  Picker,
  PickerItem,
  ProgressCircle,
  Switch,
  Text,
  TextField,
} from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import { type LlmProviderId } from '../../../../shared/llm'
import { useTranslation } from '../../../localization/useTranslation'
import { LlmHealthStatus } from '../LlmHealthStatus'
import { ModelComboBox } from '../ModelComboBox'
import { type LlmSettingsActions, type LlmSettingsState } from '../state/settingsContracts'

const fullWidth = style({ width: 'full' })

export function LlmSettingsSection({
  state,
  actions,
}: {
  state: LlmSettingsState
  actions: LlmSettingsActions
}) {
  const { t } = useTranslation()
  const credential = state.providerSettings[state.activeProvider]?.credential
  const showCredentialInput = !credential?.configured || state.editingKey
  return (
    <div className="settings-grid llm-settings-grid">
      <section className="llm-settings-section" aria-labelledby="primary-llm-title">
        <div className="llm-section-heading">
          <Heading id="primary-llm-title" level={3}>
            {t('settings.llm.primary')}
          </Heading>
          <LlmHealthStatus health={state.health} />
        </div>
        <Picker
          label={t('common.provider')}
          selectedKey={state.activeProvider}
          onSelectionChange={(key) => {
            actions.setActiveProvider(String(key) as LlmProviderId)
            actions.setEditingKey(false)
            actions.setKeyInput('')
          }}
          styles={fullWidth}
        >
          {state.providers.map((provider) => (
            <PickerItem key={provider.id} id={provider.id}>
              {provider.displayName}
            </PickerItem>
          ))}
        </Picker>
        <div className="settings-field">
          <span className="settings-label">{t('settings.llm.apiKey')}</span>
          <div className="settings-row">
            {showCredentialInput ? (
              <TextField
                aria-label={t('settings.llm.apiKey')}
                value={state.keyInput}
                onChange={actions.setKeyInput}
                type="password"
                placeholder={t('settings.llm.newKey')}
                UNSAFE_className="grow"
              />
            ) : (
              <TextField
                aria-label={t('settings.llm.apiKey')}
                value="••••••••"
                isReadOnly
                UNSAFE_className="grow"
              />
            )}
            {showCredentialInput ? (
              <ActionButton
                onPress={() => void actions.saveCredential()}
                isDisabled={!state.keyInput.trim() || credential?.secureStorageAvailable === false}
              >
                <Text>{t('settings.llm.saveKey')}</Text>
              </ActionButton>
            ) : (
              <>
                <ActionButton onPress={() => actions.setEditingKey(true)}>
                  <Text>{t('settings.llm.replaceKey')}</Text>
                </ActionButton>
                <ActionButton onPress={() => void actions.forgetCredential()}>
                  <Text>{t('settings.llm.deleteKey')}</Text>
                </ActionButton>
              </>
            )}
          </div>
          {credential?.configured && !state.editingKey && (
            <span className="settings-hint" role="status">
              {t('settings.llm.keyConfigured')}
            </span>
          )}
          {credential?.lastError && (
            <span className="settings-hint">{t('settings.llm.secureStorageError')}</span>
          )}
          {credential?.secureStorageAvailable === false && (
            <span className="settings-hint">{t('settings.llm.secureStorageUnavailable')}</span>
          )}
        </div>
        <div className="settings-field">
          <ModelComboBox
            label={t('common.model')}
            models={state.models}
            selectedId={state.selectedModel}
            isDisabled={state.modelsState !== 'ready'}
            isLoading={state.modelsState === 'loading'}
            showCapabilities
            onSelect={(id) => actions.updateProviderSettings(state.activeProvider, id)}
          />
          <span className="settings-hint">
            {state.modelsState === 'loading' && (
              <>
                <ProgressCircle
                  aria-label={t('settings.llm.modelsLoading')}
                  isIndeterminate
                  size="S"
                />{' '}
                {t('settings.llm.modelsLoading')}
              </>
            )}
            {state.modelsState === 'empty' && t('settings.llm.modelsEmpty')}
            {state.modelsState === 'missing-key' && t('settings.llm.modelsMissingKey')}
            {state.modelsState === 'auth-error' && t('settings.llm.modelsAuthError')}
            {state.modelsState === 'network-error' && t('settings.llm.modelsNetworkError')}
          </span>
          {(state.modelsState === 'network-error' || state.modelsState === 'auth-error') && (
            <ActionButton onPress={() => void actions.loadModels(state.activeProvider)}>
              <Text>{t('settings.llm.loadModels')}</Text>
            </ActionButton>
          )}
        </div>
      </section>
      <Divider />
      <section className="llm-settings-section" aria-labelledby="backlog-selector-title">
        <div className="llm-selector-title-row">
          <Heading id="backlog-selector-title" level={3}>
            {t('settings.llm.smart.title')}
          </Heading>
          <div className="llm-selector-actions">
            <Switch
              aria-label={t('settings.llm.smart.enable')}
              isSelected={state.backlogRole.enabled}
              onChange={(enabled) => actions.setBacklogRole((value) => ({ ...value, enabled }))}
            />
            <ContextualHelp variant="info" size="S" aria-label={t('settings.llm.smart.more')}>
              <Heading>{t('settings.llm.smart.title')}</Heading>
              <Content>{t('settings.llm.smart.description')}</Content>
            </ContextualHelp>
          </div>
        </div>
        <Text UNSAFE_className="settings-hint">{t('settings.llm.smart.hint')}</Text>
        {state.backlogRole.enabled && (
          <div className="llm-selector-fields">
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
                .filter((provider) => state.providerSettings[provider.id]?.credential.configured)
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
    </div>
  )
}
