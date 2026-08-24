import {
  ActionButton,
  Badge,
  Button,
  Heading,
  Picker,
  PickerItem,
  StatusLight,
  Text,
  TextField,
} from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }
import { type Key, useEffect, useMemo, useState } from 'react'

import { type LlmProviderId, type ModelInfo, type ProviderProfile } from '../../../shared/llm'
import { controller } from '../../Controller'
import { type ControllerState } from '../../controller/contracts'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import { ModelComboBox } from '../settings/ModelComboBox'

const fullWidth = style({ width: 'full' })

interface SetupCenterProps {
  state: ControllerState
  onClose: () => void
  onComplete: () => void
  onToggleOverlay: (visible: boolean) => Promise<void>
}

type SetupActionState = 'idle' | 'busy' | 'ready' | 'error'

export function SetupCenter({ state, onClose, onComplete, onToggleOverlay }: SetupCenterProps) {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [provider, setProvider] = useState<LlmProviderId>(state.llmReadiness.providerId)
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [model, setModel] = useState('')
  const [config, setConfig] = useState<Awaited<ReturnType<typeof window.api.config.get>> | null>(
    null,
  )
  const [aiAction, setAiAction] = useState<SetupActionState>('idle')
  const [avatarAction, setAvatarAction] = useState<SetupActionState>('idle')
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [microphoneId, setMicrophoneId] = useState('')

  useEffect(() => {
    const devices =
      navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? Promise.resolve([])
    observeRendererPromise(
      Promise.all([window.api.llm.providers(), window.api.config.get(), devices]).then(
        ([availableProviders, currentConfig, availableDevices]) => {
          setProviders(availableProviders)
          setConfig(currentConfig)
          setProvider(currentConfig.llm.activeProvider)
          setAccountId(
            currentConfig.llm.providers[currentConfig.llm.activeProvider].accountId ?? '',
          )
          setModel(currentConfig.llm.providers[currentConfig.llm.activeProvider].model)
          setMicrophoneId(currentConfig.micDeviceId)
          setMicrophones(availableDevices.filter((device) => device.kind === 'audioinput'))
        },
      ),
      'load Setup Center data',
    )
  }, [])

  const credentialConfigured = Boolean(config?.llm.providers[provider].credential.configured)
  const providerProfile = providers.find((item) => item.id === provider)
  const accountIdReady =
    providerProfile?.requiresAccountId !== true || /^[a-f0-9]{32}$/iu.test(accountId.trim())
  const aiComplete =
    accountIdReady &&
    credentialConfigured &&
    Boolean(model) &&
    state.llmReadiness.reason !== 'missing-credential' &&
    state.llmReadiness.reason !== 'model-missing' &&
    state.llmReadiness.reason !== 'checking'
  const readinessCopy = useMemo(
    () => t(`setup.ai.status.${state.llmReadiness.reason}`),
    [state.llmReadiness.reason, t],
  )

  const loadModels = async (): Promise<void> => {
    setAiAction('busy')
    const result = await window.api.llm.fetchModels(provider, accountId)
    if (!result.ok) {
      setAiAction('error')
      return
    }
    setModels(result.models ?? [])
    setAiAction('ready')
  }

  const saveCredential = async (): Promise<void> => {
    if (!apiKey.trim() || !accountIdReady || !config) return
    setAiAction('busy')
    const nextLlm = {
      ...config.llm,
      providers: {
        ...config.llm.providers,
        [provider]: { ...config.llm.providers[provider], accountId: accountId.trim() },
      },
    }
    const saved = await window.api.config.save({ llm: nextLlm })
    if (!saved.ok) {
      setAiAction('error')
      return
    }
    const credential = await window.api.llm.saveCredential(provider, apiKey.trim())
    setApiKey('')
    const current = await window.api.config.get()
    setConfig({
      ...current,
      llm: {
        ...current.llm,
        providers: {
          ...current.llm.providers,
          [provider]: { ...current.llm.providers[provider], credential },
        },
      },
    })
    if (!credential.configured) {
      setAiAction('error')
      return
    }
    await loadModels()
  }

  const saveModel = async (nextModel: string): Promise<void> => {
    if (!config) return
    const nextLlm = {
      ...config.llm,
      activeProvider: provider,
      providers: {
        ...config.llm.providers,
        [provider]: {
          ...config.llm.providers[provider],
          accountId: accountId.trim(),
          model: nextModel,
        },
      },
    }
    const result = await window.api.config.save({ llm: nextLlm })
    if (!result.ok) {
      setAiAction('error')
      return
    }
    setModel(nextModel)
    setConfig({ ...config, llm: nextLlm })
    await controller.checkLlmHealth()
  }

  const pickAvatar = async (): Promise<void> => {
    setAvatarAction('busy')
    const result = await window.api.vrm.pick()
    if (!result.ok || !result.assetHandle) {
      setAvatarAction('error')
      return
    }
    controller.selectVrm(result.assetHandle)
    setConfig(await window.api.config.get())
    setAvatarAction('ready')
  }

  const selectMicrophone = async (key: Key | null): Promise<void> => {
    if (key === null) return
    const deviceId = String(key) === '__default__' ? '' : String(key)
    const result = await window.api.config.save({ micDeviceId: deviceId })
    if (!result.ok) return
    setMicrophoneId(deviceId)
    controller.setMicrophone(deviceId)
  }

  const complete = async (): Promise<void> => {
    const result = await window.api.config.save({
      setup: { completed: true, completedAt: new Date().toISOString() },
    })
    if (!result.ok) return
    onComplete()
  }

  const enableOverlay = async (): Promise<void> => {
    const result = await window.api.config.save({
      overlayViewMode: 'bust',
      overlayCorner: 'bottom-right',
    })
    if (!result.ok) {
      setAvatarAction('error')
      return
    }
    await controller.setOverlayViewMode('bust')
    await onToggleOverlay(true)
  }

  return (
    <section className="setup-center" aria-labelledby="setup-center-title">
      <header className="setup-hero">
        <Text UNSAFE_className="setup-eyebrow">{t('setup.eyebrow')}</Text>
        <Heading id="setup-center-title" level={2}>
          {t('setup.title')}
        </Heading>
        <Text UNSAFE_className="setup-intro">{t('setup.intro')}</Text>
      </header>

      <ol className="setup-steps">
        <li className="setup-step">
          <div className="setup-step-heading">
            <Heading level={3}>{t('setup.ai.title')}</Heading>
            <Badge size="S" variant="informative">
              {t('setup.required')}
            </Badge>
          </div>
          <Picker
            label={t('common.provider')}
            selectedKey={provider}
            onSelectionChange={(key) => {
              const next = String(key) as LlmProviderId
              setProvider(next)
              setAccountId(config?.llm.providers[next].accountId ?? '')
              setModel(config?.llm.providers[next].model ?? '')
              setModels([])
            }}
            styles={fullWidth}
          >
            {providers.map((item) => (
              <PickerItem key={item.id} id={item.id}>
                {item.displayName}
              </PickerItem>
            ))}
          </Picker>
          {providerProfile?.requiresAccountId && (
            <TextField
              label={t('setup.ai.accountId')}
              value={accountId}
              autoComplete="off"
              onChange={(value) => {
                setAccountId(value)
                setModels([])
              }}
              styles={fullWidth}
            />
          )}
          <TextField
            label={provider === 'cloudflare' ? t('setup.ai.apiToken') : t('setup.ai.apiKey')}
            type="password"
            value={apiKey}
            autoComplete="off"
            onChange={setApiKey}
            styles={fullWidth}
          />
          <div className="setup-actions">
            <Button
              variant="primary"
              isDisabled={!apiKey.trim() || !accountIdReady}
              isPending={aiAction === 'busy'}
              onPress={() => void saveCredential()}
            >
              {provider === 'cloudflare' ? t('setup.ai.saveToken') : t('setup.ai.saveKey')}
            </Button>
            <ActionButton
              isDisabled={!credentialConfigured || !accountIdReady}
              isPending={aiAction === 'busy'}
              onPress={() => observeRendererPromise(loadModels(), 'load Setup Center models')}
            >
              {t('setup.ai.loadModels')}
            </ActionButton>
          </div>
          <ModelComboBox
            label={t('common.model')}
            models={models}
            selectedId={model}
            isDisabled={models.length === 0}
            isLoading={aiAction === 'busy'}
            onSelect={(id) => void saveModel(id)}
          />
          <StatusLight
            variant={
              aiComplete
                ? 'positive'
                : aiAction === 'error' ||
                    state.llmReadiness.reason === 'auth-error' ||
                    state.llmReadiness.reason === 'access-error' ||
                    state.llmReadiness.reason === 'network-error'
                  ? 'negative'
                  : 'neutral'
            }
            role="status"
            size="S"
          >
            {readinessCopy}
          </StatusLight>
        </li>

        <li className="setup-step">
          <div className="setup-step-heading">
            <Heading level={3}>{t('setup.avatar.title')}</Heading>
            <Badge size="S" variant="gray">
              {t('setup.optional')}
            </Badge>
          </div>
          <Text UNSAFE_className="setup-step-description">{t('setup.avatar.description')}</Text>
          <Button
            variant="secondary"
            isPending={avatarAction === 'busy'}
            onPress={() => void pickAvatar()}
          >
            {t('settings.avatar.chooseFile')}
          </Button>
          <StatusLight
            role="status"
            size="S"
            variant={
              state.vrmConfigured ? 'positive' : avatarAction === 'error' ? 'negative' : 'neutral'
            }
          >
            {state.vrmConfigured
              ? t('setup.avatar.ready')
              : avatarAction === 'error'
                ? t('setup.avatar.error')
                : t('setup.optional')}
          </StatusLight>
        </li>

        <li className="setup-step">
          <div className="setup-step-heading">
            <Heading level={3}>{t('setup.microphone.title')}</Heading>
            <Badge size="S" variant="gray">
              {t('setup.optional')}
            </Badge>
          </div>
          <Picker
            label={t('settings.speech.microphone')}
            selectedKey={microphoneId || '__default__'}
            onSelectionChange={(key) => void selectMicrophone(key)}
            styles={fullWidth}
          >
            <PickerItem id="__default__">{t('settings.speech.systemDefault')}</PickerItem>
            {microphones.map((device, index) => (
              <PickerItem key={device.deviceId} id={device.deviceId}>
                {device.label || t('setup.microphone.device', { number: index + 1 })}
              </PickerItem>
            ))}
          </Picker>
          <Text UNSAFE_className="setup-step-description">{t('setup.microphone.explicit')}</Text>
        </li>

        <li className="setup-step">
          <div className="setup-step-heading">
            <Heading level={3}>{t('setup.overlay.title')}</Heading>
            <Badge size="S" variant="gray">
              {t('setup.optional')}
            </Badge>
          </div>
          <Text UNSAFE_className="setup-step-description">{t('setup.overlay.description')}</Text>
          <Button
            variant="secondary"
            isDisabled={!state.vrmConfigured}
            isPending={state.overlayState === 'opening'}
            onPress={() => void enableOverlay()}
          >
            {t('setup.overlay.enable')}
          </Button>
          <StatusLight
            role="status"
            size="S"
            variant={state.overlayState === 'on' ? 'positive' : 'neutral'}
          >
            {state.overlayState === 'on' ? t('setup.overlay.ready') : t('setup.optional')}
          </StatusLight>
        </li>
      </ol>

      <footer className="setup-footer">
        <Button variant="secondary" onPress={onClose}>
          {t('setup.later')}
        </Button>
        <Button variant="primary" isDisabled={!aiComplete} onPress={() => void complete()}>
          {t('setup.startChatting')}
        </Button>
      </footer>
    </section>
  )
}
