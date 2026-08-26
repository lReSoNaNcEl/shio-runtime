import {
  Button,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  InlineAlert,
  NumberField,
  Picker,
  PickerItem,
  Text,
} from '@react-spectrum/s2'
import { useEffect, useState } from 'react'

import {
  type ComputerUseVisionRoleConfig,
  type LlmPublicConfig,
  type ModelInfo,
  type ProviderProfile,
} from '../../../../shared/llm'
import { useTranslation } from '../../../localization/useTranslation'
import { observeRendererPromise } from '../../../reliability/observePromise'
import { ModelComboBox } from '../../settings/ModelComboBox'

const DEFAULT_ROLE: ComputerUseVisionRoleConfig = {
  providerId: '',
  model: '',
  timeoutMs: 15_000,
  maxSteps: 30,
}

export function BrowserVisualModelSettings() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<LlmPublicConfig | null>(null)
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [role, setRole] = useState<ComputerUseVisionRoleConfig>(DEFAULT_ROLE)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    observeRendererPromise(
      (async () => {
        try {
          const [settings, profiles] = await Promise.all([
            window.api.config.get(),
            window.api.llm.providers(),
          ])
          if (!active) return
          setConfig(settings.llm)
          setProviders(profiles)
          setRole(settings.llm.roles.computerUseVision ?? DEFAULT_ROLE)
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        }
      })(),
      'load Browser Computer Use model settings',
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const providerId = role.providerId
    if (!providerId || !config) {
      setModels([])
      setLoadingModels(false)
      return
    }
    let active = true
    setLoadingModels(true)
    setError('')
    observeRendererPromise(
      (async () => {
        try {
          const result = await window.api.llm.fetchModels(
            providerId,
            config.providers[providerId].accountId,
          )
          if (!active) return
          if (!result.ok) {
            setModels([])
            setError(result.error ?? t('plugins.browserControl.modelLoadFailed'))
            return
          }
          setModels((result.models ?? []).filter((model) => model.capabilities.supportsVision))
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          if (active) setLoadingModels(false)
        }
      })(),
      'load Browser Computer Use vision models',
    )
    return () => {
      active = false
    }
  }, [config, role.providerId, t])

  const save = async (): Promise<void> => {
    if (!config || (role.providerId && !role.model.trim())) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const result = await window.api.config.save({
        llm: {
          ...config,
          roles: {
            ...config.roles,
            computerUseVision: role,
          },
        },
      })
      if (!result.ok) throw new Error(result.error)
      const settings = await window.api.config.get()
      setConfig(settings.llm)
      setRole(settings.llm.roles.computerUseVision)
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const selectedProvider = role.providerId || 'auto'
  const explicitModelMissing = Boolean(role.providerId && !role.model.trim())

  return (
    <Disclosure isQuiet>
      <DisclosureTitle level={4}>{t('plugins.browserControl.advancedModel')}</DisclosureTitle>
      <DisclosurePanel>
        <div className="plugin-model-settings">
          <Text>{t('plugins.browserControl.modelSettingsDescription')}</Text>
          <Picker
            label={t('plugins.browserControl.modelProvider')}
            selectedKey={selectedProvider}
            onSelectionChange={(key) => {
              const selected = String(key ?? 'auto')
              const providerId = providers.find((provider) => provider.id === selected)?.id ?? ''
              setRole((current) => ({ ...current, providerId, model: '' }))
              setSaved(false)
            }}
          >
            <PickerItem id="auto">{t('plugins.browserControl.modelAuto')}</PickerItem>
            {providers.map((provider) => (
              <PickerItem key={provider.id} id={provider.id}>
                {provider.displayName}
              </PickerItem>
            ))}
          </Picker>

          {role.providerId ? (
            <ModelComboBox
              label={t('plugins.browserControl.modelChoice')}
              models={models}
              selectedId={role.model}
              isDisabled={loadingModels || models.length === 0}
              isLoading={loadingModels}
              onSelect={(model) => {
                setRole((current) => ({ ...current, model }))
                setSaved(false)
              }}
            />
          ) : (
            <Text>{t('plugins.browserControl.modelAutoHint')}</Text>
          )}

          <div className="plugin-project-fields">
            <NumberField
              label={t('plugins.browserControl.modelTimeout')}
              value={role.timeoutMs}
              minValue={5_000}
              maxValue={60_000}
              step={1_000}
              onChange={(timeoutMs) => {
                setRole((current) => ({ ...current, timeoutMs }))
                setSaved(false)
              }}
            />
            <NumberField
              label={t('plugins.browserControl.modelMaxSteps')}
              value={role.maxSteps}
              minValue={1}
              maxValue={300}
              step={1}
              onChange={(maxSteps) => {
                setRole((current) => ({ ...current, maxSteps }))
                setSaved(false)
              }}
            />
          </div>

          <div className="plugin-action-row">
            <Button
              variant="primary"
              isPending={saving}
              isDisabled={!config || saving || explicitModelMissing}
              onPress={() => observeRendererPromise(save(), 'save Browser Computer Use model')}
            >
              {t('common.save')}
            </Button>
            {saved ? <Text>{t('plugins.browserControl.modelSaved')}</Text> : null}
          </div>

          {error ? (
            <InlineAlert variant="negative" fillStyle="subtleFill">
              {error}
            </InlineAlert>
          ) : null}
        </div>
      </DisclosurePanel>
    </Disclosure>
  )
}
