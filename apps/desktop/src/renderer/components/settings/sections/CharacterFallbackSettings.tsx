import { ActionButton, Heading, Picker, PickerItem, Text } from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }
import { useEffect, useState } from 'react'

import {
  type LlmProviderId,
  type LlmRoleCandidate,
  MAX_CHARACTER_FALLBACKS,
  type ModelInfo,
} from '../../../../shared/llm'
import { useTranslation } from '../../../localization/useTranslation'
import { observeRendererPromise } from '../../../reliability/observePromise'
import { CodexReasoningPicker } from '../CodexReasoningPicker'
import { ModelComboBox } from '../ModelComboBox'
import {
  type LlmSettingsActions,
  type LlmSettingsState,
  type ModelsState,
} from '../state/settingsContracts'
import { deduplicateModelsById } from '../state/settingsParsers'

const fullWidth = style({ width: 'full' })

/** Ordered Character fallbacks among the existing providers. They serve a reply
 * only when the primary model fails before its first response byte. */
export function CharacterFallbackSettings({
  state,
  actions,
}: {
  state: Pick<LlmSettingsState, 'providers' | 'providerSettings' | 'characterFallbacks'>
  actions: Pick<LlmSettingsActions, 'setCharacterFallbacks' | 'setCodexReasoningEffort'>
}) {
  const { t } = useTranslation()
  const update = (index: number, patch: Partial<LlmRoleCandidate>) =>
    actions.setCharacterFallbacks((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    )
  return (
    <section className="llm-settings-section" aria-labelledby="character-fallback-title">
      <Heading id="character-fallback-title" level={3}>
        {t('settings.llm.fallback.title')}
      </Heading>
      <Text UNSAFE_className="settings-hint">{t('settings.llm.fallback.description')}</Text>
      {state.characterFallbacks.map((fallback, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fallbacks are an ordered, bounded list edited in place.
        <div key={index} className="settings-field">
          <Picker
            label={t('settings.llm.fallback.provider', { position: index + 1 })}
            selectedKey={fallback.providerId}
            onSelectionChange={(key) => {
              if (key !== null && key !== fallback.providerId)
                update(index, { providerId: String(key) as LlmProviderId, model: '' })
            }}
            styles={fullWidth}
          >
            {state.providers.map((provider) => (
              <PickerItem key={provider.id} id={provider.id}>
                {provider.displayName}
              </PickerItem>
            ))}
          </Picker>
          <CharacterFallbackModelPicker
            key={`${fallback.providerId}:${state.providerSettings[fallback.providerId]?.accountId ?? ''}`}
            candidate={fallback}
            state={state}
            onSelect={(model) => update(index, { model })}
            setEffort={actions.setCodexReasoningEffort}
          />
          <ActionButton
            onPress={() =>
              actions.setCharacterFallbacks((current) =>
                current.filter((_entry, position) => position !== index),
              )
            }
          >
            <Text>{t('settings.llm.fallback.remove')}</Text>
          </ActionButton>
        </div>
      ))}
      <ActionButton
        isDisabled={
          state.characterFallbacks.length >= MAX_CHARACTER_FALLBACKS || state.providers.length === 0
        }
        onPress={() =>
          actions.setCharacterFallbacks((current) => [
            ...current,
            { providerId: state.providers[0]?.id ?? 'groq', model: '' },
          ])
        }
      >
        <Text>{t('settings.llm.fallback.add')}</Text>
      </ActionButton>
    </section>
  )
}

/** Catalog is presentation data from Main; selection never changes the primary role. */
function CharacterFallbackModelPicker({
  candidate,
  state,
  onSelect,
  setEffort,
}: {
  candidate: LlmRoleCandidate
  state: Pick<LlmSettingsState, 'providers' | 'providerSettings'>
  onSelect: (model: string) => void
  setEffort: LlmSettingsActions['setCodexReasoningEffort']
}) {
  const { t } = useTranslation()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [status, setStatus] = useState<ModelsState>('loading')
  const [reload, setReload] = useState(0)
  const providerId = candidate.providerId
  const profile = state.providers.find((provider) => provider.id === providerId)
  const accountId = state.providerSettings[providerId]?.accountId ?? ''
  const credential = state.providerSettings[providerId]?.credential
  const requiresAccount = profile?.requiresAccountId
  const requiresKey = profile?.modelsRequireApiKey

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload explicitly refreshes the read-only provider catalog.
  useEffect(() => {
    let current = true
    setModels([])
    if (requiresKey === undefined) {
      setStatus('loading')
      return
    }
    if (requiresAccount && !/^[a-f0-9]{32}$/iu.test(accountId.trim())) {
      setStatus('missing-account-id')
      return
    }
    if (requiresKey && !credential?.configured) {
      setStatus('missing-key')
      return
    }
    setStatus('loading')
    observeRendererPromise(
      window.api.llm
        .fetchModels(providerId, accountId)
        .then((result) => {
          if (!current) return
          if (result.ok) {
            const available = deduplicateModelsById(result.models ?? [])
            setModels(available)
            setStatus(available.length ? 'ready' : 'empty')
          } else
            setStatus(
              result.kind === 'auth'
                ? 'auth-error'
                : result.kind === 'access'
                  ? 'access-error'
                  : result.kind === 'configuration' && requiresAccount
                    ? 'missing-account-id'
                    : 'network-error',
            )
        })
        .catch(() => {
          if (current) setStatus('network-error')
        }),
      'load Character fallback models',
    )
    return () => {
      current = false
    }
  }, [providerId, accountId, credential, requiresAccount, requiresKey, reload])

  const hints = {
    idle: null,
    ready: null,
    loading: 'settings.llm.modelsLoading',
    empty: 'settings.llm.modelsEmpty',
    'missing-account-id': 'settings.llm.modelsMissingAccountId',
    'missing-key': 'settings.llm.modelsMissingKey',
    'auth-error': 'settings.llm.modelsAuthError',
    'access-error': 'settings.llm.modelsAccessError',
    'network-error': 'settings.llm.modelsNetworkError',
  } as const
  const hint = hints[status]
  return (
    <>
      <ModelComboBox
        label={t('common.model')}
        models={models}
        selectedId={candidate.model}
        isDisabled={status !== 'ready'}
        isLoading={status === 'loading'}
        showCapabilities
        onSelect={onSelect}
      />
      {providerId === 'codex-cli' && status === 'ready' && (
        <CodexReasoningPicker
          options={models.find((model) => model.id === candidate.model)?.reasoning}
          value={state.providerSettings[providerId].codexReasoningByModel?.[candidate.model]}
          onChange={(effort) => setEffort(candidate.model, effort)}
        />
      )}
      {hint && <Text UNSAFE_className="settings-hint">{t(hint)}</Text>}
      {profile?.requiresApiKey && !requiresKey && !credential?.configured && (
        <Text UNSAFE_className="settings-hint">{t('settings.llm.fallback.keyMissing')}</Text>
      )}
      {providerId === 'codex-cli' && status === 'auth-error' && (
        <Text UNSAFE_className="settings-hint">{t('settings.llm.codexLogin')}</Text>
      )}
      <ActionButton
        isDisabled={
          status === 'loading' || status === 'missing-key' || status === 'missing-account-id'
        }
        onPress={() => setReload((value) => value + 1)}
      >
        <Text>{t('settings.llm.loadModels')}</Text>
      </ActionButton>
    </>
  )
}
