import { useEffect, useRef, useState } from 'react'

import { DEFAULT_SPEECH_URL } from '../../../../shared/config'
import type {
  BacklogSelectorRoleConfig,
  LlmProviderId,
  ModelInfo,
  ProviderCredentials,
  ProviderProfile,
} from '../../../../shared/llm'
import type { UiLocale } from '../../../../shared/localization'
import {
  isValidProjectBranch,
  isValidProjectRepository,
  type ProjectAwarenessStatus,
} from '../../../../shared/project-awareness'
import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'
import { controller } from '../../../Controller'
import {
  defaultContinuousListeningSettings,
  isCuriosityControlEnabled,
  parseTunedNumber,
} from '../../../speech/continuous-listening/tuning'
import type { AttentionMode } from '../../../speech/continuous-listening/types'
import type {
  ModelsState,
  ProjectSettingsState,
  SettingsDialogViewModel,
  SettingsSaveState,
  SettingsSection,
} from './settingsContracts'
import {
  defaultBacklogSelectorRole,
  defaultSettingsForm,
  overlayDefaults,
} from './settingsDefaults'
import {
  baseName,
  clampNumber,
  deduplicateModelsById,
  parseNumberSetting,
  parseOverlayViewMode,
  projectActionError,
} from './settingsParsers'

interface SettingsDialogStateOptions {
  isOpen: boolean
  initialSection: SettingsSection
  continuousListeningMode: AttentionMode
  passiveCompanionEnabled: boolean
  onPassiveCompanionChange: (enabled: boolean) => void
  overlayVisible: boolean
  overlayViewModeProjection: OverlayViewMode
  llmHealth: SettingsDialogViewModel['llm']['state']['health']
  onOverlayVisibleChange: (visible: boolean) => void
  onToggleOverlay: (visible: boolean) => void | Promise<void>
}

export function useSettingsDialogState({
  isOpen,
  initialSection,
  continuousListeningMode,
  passiveCompanionEnabled,
  onPassiveCompanionChange,
  overlayVisible,
  overlayViewModeProjection,
  llmHealth,
  onOverlayVisibleChange,
  onToggleOverlay,
}: SettingsDialogStateOptions): SettingsDialogViewModel {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection)
  const hydrated = useRef(false)
  const saveSequence = useRef(0)
  const saveStatusTimer = useRef<number | null>(null)
  const copiedResetTimer = useRef<number | null>(null)
  const [saveState, setSaveState] = useState<SettingsSaveState>('idle')
  const [speechUrl, setSpeechUrl] = useState(DEFAULT_SPEECH_URL)
  const [projectEnabled, setProjectEnabled] = useState(defaultSettingsForm.projectEnabled)
  const [projectRepository, setProjectRepository] = useState('')
  const [projectBranch, setProjectBranch] = useState(defaultSettingsForm.projectBranch)
  const [projectStatus, setProjectStatus] = useState<ProjectAwarenessStatus | null>(null)
  const [projectApplyState, setProjectApplyState] =
    useState<ProjectSettingsState['applyState']>('idle')
  const [projectApplyError, setProjectApplyError] = useState('')
  const [projectCredentialInput, setProjectCredentialInput] = useState('')
  const [projectActionBusy, setProjectActionBusy] = useState(false)
  const [projectForgetConfirmation, setProjectForgetConfirmation] = useState(false)
  const [lang, setLang] = useState(defaultSettingsForm.ttsLanguage)
  const [uiLocale, setUiLocale] = useState<UiLocale>('ru')
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false)
  const [developerOverlayAnimationHudEnabled, setDeveloperOverlayAnimationHudEnabledState] =
    useState(true)
  const [vrmName, setVrmName] = useState('')
  const [mics, setMics] = useState<Array<{ deviceId: string; label: string }>>([])
  const [micId, setMicId] = useState(defaultSettingsForm.microphoneId)
  const [replyCooldownMs, setReplyCooldownMs] = useState(
    defaultContinuousListeningSettings.replyCooldownMs,
  )
  const [followUpWindowMs, setFollowUpWindowMs] = useState(
    defaultContinuousListeningSettings.followUpWindowMs,
  )
  const [curiosityChancePercent, setCuriosityChancePercent] = useState(
    defaultContinuousListeningSettings.curiosityChance * 100,
  )
  const [overlayWidth, setOverlayWidth] = useState(overlayDefaults.width)
  const [overlayHeight, setOverlayHeight] = useState(overlayDefaults.height)
  const [overlayMargin, setOverlayMargin] = useState(overlayDefaults.margin)
  const [overlayOpacityPercent, setOverlayOpacityPercent] = useState(overlayDefaults.opacityPercent)
  const [overlayTransparentBackground, setOverlayTransparentBackground] = useState(true)
  const [overlayClickThrough, setOverlayClickThrough] = useState(true)
  const [overlayCorner, setOverlayCorner] = useState(overlayDefaults.corner)
  const [overlayScalePercent, setOverlayScalePercent] = useState(overlayDefaults.scalePercent)
  const [overlayViewMode, setOverlayViewMode] = useState<OverlayViewMode>('front')
  const [currentTtsVoice, setCurrentTtsVoice] = useState(defaultSettingsForm.ttsVoice)
  const [editingKey, setEditingKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [activeProvider, setActiveProvider] = useState<LlmProviderId>('groq')
  const [providerCreds, setProviderCreds] = useState<Record<string, ProviderCredentials>>({})
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([])
  const [modelsState, setModelsState] = useState<ModelsState>('idle')
  const [backlogRole, setBacklogRole] = useState<BacklogSelectorRoleConfig>(
    defaultBacklogSelectorRole,
  )
  const [backlogModels, setBacklogModels] = useState<ModelInfo[]>([])

  useEffect(() => {
    setOverlayViewMode(overlayViewModeProjection)
  }, [overlayViewModeProjection])

  useEffect(
    () => () => {
      if (copiedResetTimer.current !== null) window.clearTimeout(copiedResetTimer.current)
      if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (isOpen) return
    if (copiedResetTimer.current !== null) window.clearTimeout(copiedResetTimer.current)
    copiedResetTimer.current = null
    setCopied(false)
    hydrated.current = false
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    void (async () => {
      const cfg = await window.api.config.get()
      setActiveSection(initialSection)
      setSpeechUrl(cfg.pythonSpeechUrl)
      setProjectEnabled(cfg.projectAwareness.enabled)
      setProjectRepository(cfg.projectAwareness.repository)
      setProjectBranch(cfg.projectAwareness.branch)
      setProjectStatus(await window.api.projectAwareness.getStatus())
      setProjectApplyState('idle')
      setProjectApplyError('')
      setProjectCredentialInput('')
      setProjectActionBusy(false)
      setProjectForgetConfirmation(false)
      setLang(cfg.ttsLanguage ?? defaultSettingsForm.ttsLanguage)
      setUiLocale(cfg.uiLocale)
      setDeveloperModeEnabled(cfg.developerModeEnabled === 'true')
      setDeveloperOverlayAnimationHudEnabledState(
        cfg.developerOverlayAnimationHudEnabled !== 'false',
      )
      setCurrentTtsVoice(cfg.ttsVoice ?? defaultSettingsForm.ttsVoice)
      setReplyCooldownMs(
        parseTunedNumber(cfg.continuousListeningReplyCooldownMs, 15_000, 0, 120_000),
      )
      setFollowUpWindowMs(
        parseTunedNumber(cfg.continuousListeningFollowUpWindowMs, 20_000, 0, 120_000),
      )
      setCuriosityChancePercent(
        parseTunedNumber(cfg.continuousListeningCuriosityChance, 0.03, 0, 1) * 100,
      )
      setEditingKey(false)
      setKeyInput('')
      setActiveProvider(cfg.llm?.activeProvider ?? 'groq')
      setProviderCreds(cfg.llm?.providers ?? {})
      setBacklogRole(cfg.llm?.roles?.backlogSelector ?? defaultBacklogSelectorRole)
      setVrmName(cfg.vrmPath ? baseName(cfg.vrmPath) : '')
      setOverlayWidth(parseNumberSetting(cfg.overlayWidth, overlayDefaults.width, 250, 2000))
      setOverlayHeight(parseNumberSetting(cfg.overlayHeight, overlayDefaults.height, 250, 2000))
      setOverlayMargin(parseNumberSetting(cfg.overlayMargin, overlayDefaults.margin, 0, 500))
      setOverlayOpacityPercent(Math.round(parseNumberSetting(cfg.overlayOpacity, 1, 0, 1) * 100))
      setOverlayTransparentBackground(cfg.overlayTransparentBackground !== 'false')
      setOverlayClickThrough(cfg.overlayClickThrough !== 'false')
      setOverlayCorner(cfg.overlayCorner ?? overlayDefaults.corner)
      setOverlayScalePercent(Math.round(parseNumberSetting(cfg.overlayScale, 1, 0.5, 2) * 100))
      setOverlayViewMode(parseOverlayViewMode(cfg.overlayViewMode))
      setProviders(await window.api.llm.providers())
      setMics(await controller.listMicrophones())
      setMicId(controller.getMicrophoneId() || defaultSettingsForm.microphoneId)
      hydrated.current = true
    })()
  }, [initialSection, isOpen])

  useEffect(() => {
    if (!isOpen || activeSection !== 'project') return
    let active = true
    const refresh = (): void => {
      void window.api.projectAwareness.getStatus().then((status) => {
        if (active) setProjectStatus(status)
      })
    }
    refresh()
    const intervalId = window.setInterval(refresh, 3_000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [activeSection, isOpen])

  const savedKey = providerCreds[activeProvider]?.apiKey ?? ''
  const selectedModel = providerCreds[activeProvider]?.model ?? ''
  const activeApiKey = editingKey ? keyInput : savedKey

  const updateCredential = (id: string, patch: Partial<ProviderCredentials>): void => {
    setProviderCreds((previous) => {
      const base = previous[id] ?? { apiKey: '', model: '' }
      return { ...previous, [id]: { ...base, ...patch } }
    })
  }

  const loadModels = async (providerId: string, apiKey: string): Promise<void> => {
    setModelsState('loading')
    const result = await window.api.llm.fetchModels(providerId, apiKey)
    if (result.ok) {
      const models = deduplicateModelsById(result.models ?? [])
      setModelOptions(models)
      if (models.length === 0) {
        setModelsState('empty')
      } else {
        setModelsState('ready')
        setProviderCreds((previous) => {
          const base = previous[providerId] ?? { apiKey: '', model: '' }
          const model = models.some((candidate) => candidate.id === base.model)
            ? base.model
            : models[0].id
          return { ...previous, [providerId]: { ...base, model } }
        })
      }
      return
    }
    setModelOptions([])
    setModelsState(
      result.kind === 'auth' ? (apiKey.trim() ? 'auth-error' : 'missing-key') : 'network-error',
    )
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: preserved debounce trigger semantics; loadModels is intentionally excluded.
  useEffect(() => {
    if (!isOpen) return
    const profile = providers.find((provider) => provider.id === activeProvider)
    if (profile?.modelsRequireApiKey && !activeApiKey.trim()) {
      setModelOptions([])
      setModelsState('missing-key')
      return
    }
    const timer = window.setTimeout(() => {
      void loadModels(activeProvider, activeApiKey)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [isOpen, activeProvider, activeApiKey, providers])

  useEffect(() => {
    if (!isOpen || !backlogRole.enabled || !backlogRole.providerId) {
      setBacklogModels([])
      return
    }
    const apiKey = providerCreds[backlogRole.providerId]?.apiKey ?? ''
    const profile = providers.find((provider) => provider.id === backlogRole.providerId)
    if (profile?.modelsRequireApiKey && !apiKey) {
      setBacklogModels([])
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      void window.api.llm.fetchModels(backlogRole.providerId, apiKey).then((result) => {
        if (current) setBacklogModels(result.ok ? deduplicateModelsById(result.models ?? []) : [])
      })
    }, 400)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [isOpen, backlogRole.enabled, backlogRole.providerId, providerCreds, providers])

  const pickVrm = async (): Promise<void> => {
    const result = await window.api.vrm.pick()
    if (result.ok && result.vrmPath) {
      setVrmName(baseName(result.vrmPath))
      void controller.loadVrmFromPath(result.vrmPath)
    }
  }

  const copyKey = async (): Promise<void> => {
    if (!savedKey) return
    await navigator.clipboard.writeText(savedKey)
    if (copiedResetTimer.current !== null) window.clearTimeout(copiedResetTimer.current)
    setCopied(true)
    copiedResetTimer.current = window.setTimeout(() => {
      copiedResetTimer.current = null
      setCopied(false)
    }, 1500)
  }

  const projectSettingsValid =
    !projectEnabled ||
    (isValidProjectRepository(projectRepository) && isValidProjectBranch(projectBranch))
  const projectTargetApplied =
    projectStatus !== null &&
    projectStatus.enabled === projectEnabled &&
    projectStatus.repository === projectRepository.trim() &&
    projectStatus.branch === projectBranch.trim()
  const projectConnected =
    projectStatus !== null &&
    ['ready', 'syncing', 'indexing', 'stale'].includes(projectStatus.state)
  const projectRuntimeBusy =
    projectActionBusy ||
    projectApplyState === 'applying' ||
    (projectStatus !== null && ['connecting', 'syncing', 'indexing'].includes(projectStatus.state))

  const applyProjectSettings = async (): Promise<void> => {
    setProjectApplyState('applying')
    setProjectApplyError('')
    try {
      const status = await window.api.projectAwareness.configure({
        enabled: projectEnabled,
        provider: 'github',
        repository: projectRepository.trim(),
        branch: projectBranch.trim(),
      })
      setProjectRepository(status.repository)
      setProjectBranch(status.branch)
      setProjectStatus(status)
      setProjectApplyState('applied')
    } catch (error) {
      setProjectApplyError(projectActionError(error))
      setProjectStatus(await window.api.projectAwareness.getStatus())
      setProjectApplyState('error')
    }
  }

  const runProjectAction = async (operation: () => Promise<unknown>): Promise<void> => {
    setProjectApplyError('')
    setProjectActionBusy(true)
    try {
      await operation()
    } catch (error) {
      setProjectApplyError(projectActionError(error))
    } finally {
      setProjectStatus(await window.api.projectAwareness.getStatus())
      setProjectActionBusy(false)
    }
  }

  const saveProjectCredential = async (): Promise<void> => {
    await runProjectAction(async () => {
      const status = await window.api.projectAwareness.saveCredential(projectCredentialInput)
      setProjectStatus(status)
      setProjectCredentialInput('')
      setProjectForgetConfirmation(false)
    })
  }

  const forgetProjectCredential = async (): Promise<void> => {
    if (!projectForgetConfirmation) {
      setProjectForgetConfirmation(true)
      return
    }
    await runProjectAction(async () => {
      setProjectStatus(await window.api.projectAwareness.forgetCredential())
      setProjectCredentialInput('')
      setProjectForgetConfirmation(false)
    })
  }

  const save = async (sequence = ++saveSequence.current): Promise<void> => {
    const credentials: Record<string, ProviderCredentials> = { ...providerCreds }
    const current = credentials[activeProvider] ?? { apiKey: '', model: '' }
    credentials[activeProvider] = {
      apiKey: editingKey && keyInput.trim() ? keyInput.trim() : current.apiKey,
      model: current.model,
    }
    await window.api.config.save({
      pythonSpeechUrl: speechUrl,
      ttsVoice: currentTtsVoice,
      ttsLanguage: lang,
      uiLocale,
      developerModeEnabled: developerModeEnabled ? 'true' : 'false',
      developerOverlayAnimationHudEnabled: developerOverlayAnimationHudEnabled ? 'true' : 'false',
      ttsEngine: 'f5',
      continuousListeningReplyCooldownMs: String(replyCooldownMs),
      continuousListeningFollowUpWindowMs: String(followUpWindowMs),
      continuousListeningCuriosityChance: String(clampNumber(curiosityChancePercent / 100, 0, 1)),
      overlayWidth: String(clampNumber(overlayWidth, 250, 2000)),
      overlayHeight: String(clampNumber(overlayHeight, 250, 2000)),
      overlayMargin: String(clampNumber(overlayMargin, 0, 500)),
      overlayOpacity: String(clampNumber(overlayOpacityPercent, 0, 100) / 100),
      overlayTransparentBackground: overlayTransparentBackground ? 'true' : 'false',
      overlayCorner,
      overlayScale: String(clampNumber(overlayScalePercent, 50, 200) / 100),
      overlayViewMode,
      overlayClickThrough: overlayClickThrough ? 'true' : 'false',
      llm: {
        activeProvider,
        providers: credentials as Record<LlmProviderId, ProviderCredentials>,
        roles: { backlogSelector: backlogRole },
      },
    })
    await window.api.overlay.applySettings()
    const result = await window.api.overlay.isVisible()
    onOverlayVisibleChange(Boolean(result.visible))
    if (sequence === saveSequence.current) {
      setSaveState('saved')
      if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current)
      saveStatusTimer.current = window.setTimeout(() => setSaveState('idle'), 1800)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: preserved autosave trigger list and sequencing.
  useEffect(() => {
    if (!hydrated.current || !isOpen) return
    const sequence = ++saveSequence.current
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      void save(sequence).catch(() => {
        if (sequence === saveSequence.current) setSaveState('error')
      })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [
    speechUrl,
    lang,
    uiLocale,
    developerModeEnabled,
    developerOverlayAnimationHudEnabled,
    currentTtsVoice,
    replyCooldownMs,
    followUpWindowMs,
    curiosityChancePercent,
    overlayWidth,
    overlayHeight,
    overlayMargin,
    overlayOpacityPercent,
    overlayTransparentBackground,
    overlayClickThrough,
    overlayCorner,
    overlayScalePercent,
    overlayViewMode,
    activeProvider,
    providerCreds,
    backlogRole,
  ])

  const toggleOverlay = async (visible: boolean): Promise<void> => {
    await onToggleOverlay(visible)
    const result = await window.api.overlay.isVisible()
    onOverlayVisibleChange(Boolean(result.visible))
  }

  const resetOverlaySettings = (): void => {
    setOverlayWidth(overlayDefaults.width)
    setOverlayHeight(overlayDefaults.height)
    setOverlayMargin(overlayDefaults.margin)
    setOverlayOpacityPercent(overlayDefaults.opacityPercent)
    setOverlayTransparentBackground(overlayDefaults.transparentBackground)
    setOverlayClickThrough(overlayDefaults.clickThrough)
    setOverlayCorner(overlayDefaults.corner)
    setOverlayScalePercent(overlayDefaults.scalePercent)
    setOverlayViewMode(overlayDefaults.viewMode)
  }

  const setDeveloperOverlayAnimationHudEnabled = async (enabled: boolean): Promise<void> => {
    setDeveloperOverlayAnimationHudEnabledState(enabled)
    await window.api.config.save({
      developerOverlayAnimationHudEnabled: enabled ? 'true' : 'false',
    })
    await window.api.overlay.applySettings()
  }

  const applyDeveloperModeEnabled = async (enabled: boolean): Promise<void> => {
    setDeveloperModeEnabled(enabled)
    await window.api.config.save({
      developerModeEnabled: enabled ? 'true' : 'false',
    })
    await window.api.overlay.applySettings()
  }

  return {
    activeSection,
    setActiveSection,
    saveState,
    general: {
      state: { uiLocale },
      actions: { setUiLocale },
    },
    project: {
      state: {
        enabled: projectEnabled,
        repository: projectRepository,
        branch: projectBranch,
        status: projectStatus,
        applyState: projectApplyState,
        applyError: projectApplyError,
        credentialInput: projectCredentialInput,
        actionBusy: projectActionBusy,
        forgetConfirmation: projectForgetConfirmation,
        settingsValid: projectSettingsValid,
        targetApplied: projectTargetApplied,
        connected: projectConnected,
        runtimeBusy: projectRuntimeBusy,
        hasIndex: Boolean(projectStatus?.indexedCommit),
      },
      actions: {
        setEnabled: setProjectEnabled,
        setRepository: setProjectRepository,
        setBranch: setProjectBranch,
        setApplyState: setProjectApplyState,
        setApplyError: setProjectApplyError,
        setCredentialInput: setProjectCredentialInput,
        setForgetConfirmation: setProjectForgetConfirmation,
        apply: applyProjectSettings,
        saveCredential: saveProjectCredential,
        forgetCredential: forgetProjectCredential,
        openTokenSettings: () => window.api.projectAwareness.openTokenSettings(),
        connect: () => runProjectAction(() => window.api.projectAwareness.connect()),
        disconnect: () => runProjectAction(() => window.api.projectAwareness.disconnect()),
        sync: () => runProjectAction(() => window.api.projectAwareness.sync()),
        rebuild: () => runProjectAction(() => window.api.projectAwareness.rebuildIndex()),
      },
    },
    speech: {
      state: {
        speechUrl,
        language: lang,
        currentTtsVoice,
        microphones: mics,
        microphoneId: micId,
      },
      actions: {
        setSpeechUrl,
        setLanguage: setLang,
        setCurrentTtsVoice,
        setMicrophoneId: (id) => {
          setMicId(id)
          controller.setMicrophone(id === defaultSettingsForm.microphoneId ? '' : id)
        },
      },
    },
    listening: {
      state: {
        replyCooldownMs,
        followUpWindowMs,
        curiosityChancePercent,
        curiosityEnabled: isCuriosityControlEnabled(true, continuousListeningMode),
        mode: continuousListeningMode,
      },
      actions: {
        setMode: async (mode) => {
          await controller.setContinuousListeningMode(mode)
        },
        setReplyCooldownMs,
        setFollowUpWindowMs,
        setCuriosityChancePercent,
      },
    },
    llm: {
      state: {
        providers,
        activeProvider,
        providerCredentials: providerCreds,
        models: modelOptions,
        modelsState,
        editingKey,
        keyInput,
        copied,
        backlogRole,
        backlogModels,
        savedKey,
        selectedModel,
        health: llmHealth,
      },
      actions: {
        setActiveProvider,
        setProviderCredentials: setProviderCreds,
        updateCredential,
        setEditingKey,
        setKeyInput,
        copyKey,
        loadModels,
        setBacklogRole,
      },
    },
    avatar: {
      state: {
        vrmName,
        passiveCompanionEnabled,
        overlayVisible,
        overlayViewMode,
        overlayWidth,
        overlayHeight,
        overlayMargin,
        overlayOpacityPercent,
        overlayTransparentBackground,
        overlayClickThrough,
        overlayCorner,
        overlayScalePercent,
      },
      actions: {
        pickVrm,
        setPassiveCompanionEnabled: onPassiveCompanionChange,
        toggleOverlay,
        setOverlayViewMode,
        setOverlayWidth,
        setOverlayHeight,
        setOverlayMargin,
        setOverlayOpacityPercent,
        setOverlayTransparentBackground,
        setOverlayClickThrough,
        setOverlayCorner,
        setOverlayScalePercent,
        resetOverlaySettings,
      },
    },
    advanced: {
      state: { developerModeEnabled, developerOverlayAnimationHudEnabled },
      actions: {
        setDeveloperModeEnabled: applyDeveloperModeEnabled,
        setDeveloperOverlayAnimationHudEnabled,
      },
    },
  }
}
