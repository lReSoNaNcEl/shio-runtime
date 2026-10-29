import {
  ActionButton,
  Heading,
  Picker,
  PickerItem,
  ProgressCircle,
  Text,
  TextField,
} from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import { type LlmProviderId } from '../../../../shared/llm'
import { useTranslation } from '../../../localization/useTranslation'
import { observeRendererPromise } from '../../../reliability/observePromise'
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
  const activeProfile = state.providers.find((provider) => provider.id === state.activeProvider)
  const accountId = state.providerSettings[state.activeProvider]?.accountId ?? ''
  const usesApiToken = state.activeProvider === 'cloudflare'
  const credentialLabel = usesApiToken ? t('settings.llm.apiToken') : t('settings.llm.apiKey')
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
        {activeProfile?.requiresAccountId && (
          <TextField
            label={t('settings.llm.accountId')}
            value={accountId}
            onChange={(value) => actions.updateProviderAccountId(state.activeProvider, value)}
            autoComplete="off"
            styles={fullWidth}
          />
        )}
        {activeProfile?.requiresApiKey !== false && (
          <div className="settings-field">
            <span className="settings-label">{credentialLabel}</span>
            <div className="settings-row">
              {showCredentialInput ? (
                <TextField
                  aria-label={credentialLabel}
                  value={state.keyInput}
                  onChange={actions.setKeyInput}
                  type="password"
                  placeholder={usesApiToken ? t('settings.llm.newToken') : t('settings.llm.newKey')}
                  UNSAFE_className="grow"
                />
              ) : (
                <TextField
                  aria-label={credentialLabel}
                  value="••••••••"
                  isReadOnly
                  UNSAFE_className="grow"
                />
              )}
              {showCredentialInput ? (
                <ActionButton
                  onPress={() =>
                    observeRendererPromise(actions.saveCredential(), 'save LLM credential')
                  }
                  isDisabled={
                    !state.keyInput.trim() || credential?.secureStorageAvailable === false
                  }
                >
                  <Text>
                    {usesApiToken ? t('settings.llm.saveToken') : t('settings.llm.saveKey')}
                  </Text>
                </ActionButton>
              ) : (
                <>
                  <ActionButton onPress={() => actions.setEditingKey(true)}>
                    <Text>
                      {usesApiToken ? t('settings.llm.replaceToken') : t('settings.llm.replaceKey')}
                    </Text>
                  </ActionButton>
                  <ActionButton
                    onPress={() =>
                      observeRendererPromise(actions.forgetCredential(), 'forget LLM credential')
                    }
                  >
                    <Text>
                      {usesApiToken ? t('settings.llm.deleteToken') : t('settings.llm.deleteKey')}
                    </Text>
                  </ActionButton>
                </>
              )}
            </div>
            {credential?.configured && !state.editingKey && (
              <span className="settings-hint" role="status">
                {usesApiToken ? t('settings.llm.tokenConfigured') : t('settings.llm.keyConfigured')}
              </span>
            )}
            {credential?.lastError && (
              <span className="settings-hint">{t('settings.llm.secureStorageError')}</span>
            )}
            {credential?.secureStorageAvailable === false && (
              <span className="settings-hint">{t('settings.llm.secureStorageUnavailable')}</span>
            )}
          </div>
        )}
        <div className="settings-field">
          <ModelComboBox
            label={t('common.model')}
            models={state.models}
            selectedId={state.selectedModel}
            isDisabled={state.modelsState !== 'ready'}
            isLoading={state.modelsState === 'loading'}
            showCapabilities
            showImageFilter
            showVisionFilter
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
            {state.modelsState === 'missing-account-id' && t('settings.llm.modelsMissingAccountId')}
            {state.modelsState === 'missing-key' && t('settings.llm.modelsMissingKey')}
            {state.modelsState === 'auth-error' && t('settings.llm.modelsAuthError')}
            {state.modelsState === 'access-error' && t('settings.llm.modelsAccessError')}
            {state.modelsState === 'network-error' && t('settings.llm.modelsNetworkError')}
          </span>
          {(state.modelsState === 'network-error' ||
            state.modelsState === 'auth-error' ||
            state.modelsState === 'access-error') && (
            <ActionButton
              onPress={() =>
                observeRendererPromise(
                  actions.loadModels(state.activeProvider),
                  'reload LLM models',
                )
              }
            >
              <Text>{t('settings.llm.loadModels')}</Text>
            </ActionButton>
          )}
        </div>
      </section>
    </div>
  )
}
