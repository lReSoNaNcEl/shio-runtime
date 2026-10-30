import { ActionButton, Heading, Picker, PickerItem, Text, TextField } from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import {
  type LlmProviderId,
  type LlmRoleCandidate,
  MAX_CHARACTER_FALLBACKS,
} from '../../../../shared/llm'
import { useTranslation } from '../../../localization/useTranslation'
import { type LlmSettingsActions, type LlmSettingsState } from '../state/settingsContracts'

const fullWidth = style({ width: 'full' })

/** Ordered Character fallbacks among the existing providers. They serve a reply
 * only when the primary model fails before its first response byte. */
export function CharacterFallbackSettings({
  state,
  actions,
}: {
  state: Pick<LlmSettingsState, 'providers' | 'providerSettings' | 'characterFallbacks'>
  actions: Pick<LlmSettingsActions, 'setCharacterFallbacks'>
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
      {state.characterFallbacks.map((fallback, index) => {
        const credential = state.providerSettings[fallback.providerId]?.credential
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: fallbacks are an ordered, bounded list edited in place.
          <div key={index} className="settings-field">
            <Picker
              label={t('settings.llm.fallback.provider', { position: index + 1 })}
              selectedKey={fallback.providerId}
              onSelectionChange={(key) =>
                update(index, { providerId: String(key) as LlmProviderId })
              }
              styles={fullWidth}
            >
              {state.providers.map((provider) => (
                <PickerItem key={provider.id} id={provider.id}>
                  {provider.displayName}
                </PickerItem>
              ))}
            </Picker>
            <TextField
              label={t('common.model')}
              value={fallback.model}
              onChange={(model) => update(index, { model })}
              autoComplete="off"
              styles={fullWidth}
            />
            {credential && !credential.configured && (
              <span className="settings-hint">{t('settings.llm.fallback.keyMissing')}</span>
            )}
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
        )
      })}
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
