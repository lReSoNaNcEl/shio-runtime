import { useCallback, useEffect, useRef, useState } from 'react'

import type { AppSettings } from '../../../../shared/config'
import type { LlmProviderId } from '../../../../shared/llm'
import {
  isValidProjectBranch,
  isValidProjectRepository,
} from '../../../../shared/project-awareness'
import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'
import { controller } from '../../../Controller'
import type {
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
import { useAiSettings } from './useAiSettings'
import { useAvatarSettings } from './useAvatarSettings'
import { useDeveloperSettings } from './useDeveloperSettings'
import { useGeneralSettings } from './useGeneralSettings'
import { useProjectSettings } from './useProjectSettings'
import { useSettingsNavigation } from './useSettingsNavigation'
import { useVoiceSettings } from './useVoiceSettings'

interface SettingsDialogStateOptions {
  isOpen: boolean
  initialSection: SettingsSection
  overlayVisible: boolean
  overlayViewModeProjection: OverlayViewMode
  llmHealth: SettingsDialogViewModel['llm']['state']['health']
  voiceWarmup: SettingsDialogViewModel['speech']['state']['voiceWarmup']
  continuousListeningState: SettingsDialogViewModel['speech']['state']['continuousListeningState']
  onToggleContinuousListening: () => void
  onOverlayVisibleChange: (visible: boolean) => void
  onToggleOverlay: (visible: boolean) => void | Promise<void>
}

export function useSettingsDialogState({
  isOpen,
  initialSection,
  overlayVisible,
  overlayViewModeProjection,
  llmHealth,
  voiceWarmup,
  continuousListeningState,
  onToggleContinuousListening,
  onOverlayVisibleChange,
  onToggleOverlay,
}: SettingsDialogStateOptions): SettingsDialogViewModel {
  const { activeSection, setActiveSection } = useSettingsNavigation(isOpen, initialSection)
  const hydrated = useRef(false)
  const saveSequence = useRef(0)
  const saveStatusTimer = useRef<number | null>(null)
  const microphoneTestSequence = useRef(0)
  const microphoneTestRecording = useRef<ArrayBuffer | null>(null)
  const [saveState, setSaveState] = useState<SettingsSaveState>('idle')
  const {
    projectActionBusy,
    projectApplyError,
    projectApplyState,
    projectBranch,
    projectCredentialInput,
    projectCredentialSaveState,
    projectEnabled,
    projectForgetConfirmation,
    projectRepository,
    projectStatus,
    setProjectActionBusy,
    setProjectApplyError,
    setProjectApplyState,
    setProjectBranch,
    setProjectCredentialInput,
    setProjectCredentialSaveState,
    setProjectEnabled,
    setProjectForgetConfirmation,
    setProjectRepository,
    setProjectStatus,
  } = useProjectSettings()
  const { uiLocale, setUiLocale } = useGeneralSettings()
  const {
    developerModeEnabled,
    developerOverlayAnimationHudEnabled,
    setDeveloperModeEnabled,
    setDeveloperOverlayAnimationHudEnabledState,
  } = useDeveloperSettings()
  const {
    currentTtsVoice,
    lang,
    microphoneLevel,
    microphoneTestState,
    micId,
    mics,
    setCurrentTtsVoice,
    setLang,
    setMicrophoneLevel,
    setMicrophoneTestState,
    setMicId,
    setMics,
    setSpeechUrl,
    speechUrl,
  } = useVoiceSettings()
  const {
    overlayClickThrough,
    overlayCorner,
    overlayHeight,
    overlayMargin,
    overlayOpacityPercent,
    overlayScalePercent,
    overlayTransparentBackground,
    overlayViewMode,
    overlayWidth,
    setOverlayClickThrough,
    setOverlayCorner,
    setOverlayHeight,
    setOverlayMargin,
    setOverlayOpacityPercent,
    setOverlayScalePercent,
    setOverlayTransparentBackground,
    setOverlayViewMode,
    setOverlayWidth,
    setVrmName,
    vrmName,
  } = useAvatarSettings()
  const {
    activeProvider,
    backlogModels,
    backlogRole,
    editingKey,
    keyInput,
    modelOptions,
    modelsState,
    providers,
    providerSettings,
    setActiveProvider,
    setBacklogModels,
    setBacklogRole,
    setEditingKey,
    setKeyInput,
    setModelOptions,
    setModelsState,
    setProviders,
    setProviderSettings,
  } = useAiSettings()

  // biome-ignore lint/correctness/useExhaustiveDependencies: domain hooks expose stable React state setters.
  useEffect(() => {
    setOverlayViewMode(overlayViewModeProjection)
  }, [overlayViewModeProjection])

  useEffect(
    () => () => {
      if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (isOpen) return
    hydrated.current = false
    microphoneTestSequence.current += 1
    microphoneTestRecording.current = null
    setMicrophoneTestState('idle')
    setMicrophoneLevel(0)
  }, [isOpen, setMicrophoneLevel, setMicrophoneTestState])

  // biome-ignore lint/correctness/useExhaustiveDependencies: hydration targets stable React state setters owned by domain hooks.
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
      setEditingKey(false)
      setKeyInput('')
      setActiveProvider(cfg.llm?.activeProvider ?? 'groq')
      setProviderSettings(cfg.llm.providers)
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: project status setter is stable across domain-hook renders.
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

  const selectedModel = providerSettings[activeProvider]?.model ?? ''
  const activeCredentialConfigured =
    providerSettings[activeProvider]?.credential.configured ?? false
  const backlogCredentialConfigured = backlogRole.providerId
    ? (providerSettings[backlogRole.providerId]?.credential.configured ?? false)
    : false

  const updateProviderSettings = (id: LlmProviderId, model: string): void => {
    setProviderSettings((previous) => {
      const base = previous[id]
      return { ...previous, [id]: { ...base, model } }
    })
  }

  const loadModels = async (providerId: LlmProviderId): Promise<void> => {
    setModelsState('loading')
    const result = await window.api.llm.fetchModels(providerId)
    if (result.ok) {
      const models = deduplicateModelsById(result.models ?? [])
      setModelOptions(models)
      if (models.length === 0) {
        setModelsState('empty')
      } else {
        setModelsState('ready')
        setProviderSettings((previous) => {
          const base = previous[providerId]
          const model = models.some((candidate) => candidate.id === base.model)
            ? base.model
            : models[0].id
          if (model === base.model) return previous
          return { ...previous, [providerId]: { ...base, model } }
        })
      }
      return
    }
    setModelOptions([])
    setModelsState(
      result.kind === 'auth'
        ? providerSettings[providerId]?.credential.configured
          ? 'auth-error'
          : 'missing-key'
        : 'network-error',
    )
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: preserved debounce trigger semantics; loadModels is intentionally excluded.
  useEffect(() => {
    if (!isOpen) return
    const profile = providers.find((provider) => provider.id === activeProvider)
    if (profile?.modelsRequireApiKey && !activeCredentialConfigured) {
      setModelOptions([])
      setModelsState('missing-key')
      return
    }
    const timer = window.setTimeout(() => {
      void loadModels(activeProvider)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [isOpen, activeProvider, activeCredentialConfigured, providers])

  // biome-ignore lint/correctness/useExhaustiveDependencies: AI domain setters are stable React state setters.
  useEffect(() => {
    if (!isOpen || !backlogRole.enabled || !backlogRole.providerId) {
      setBacklogModels([])
      return
    }
    const profile = providers.find((provider) => provider.id === backlogRole.providerId)
    if (profile?.modelsRequireApiKey && !backlogCredentialConfigured) {
      setBacklogModels([])
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      void window.api.llm.fetchModels(backlogRole.providerId as LlmProviderId).then((result) => {
        if (current) setBacklogModels(result.ok ? deduplicateModelsById(result.models ?? []) : [])
      })
    }, 400)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [isOpen, backlogRole.enabled, backlogRole.providerId, backlogCredentialConfigured, providers])

  const pickVrm = async (): Promise<void> => {
    const result = await window.api.vrm.pick()
    if (result.ok && result.vrmPath) {
      setVrmName(baseName(result.vrmPath))
      controller.selectVrm(result.vrmPath)
    }
  }

  const saveLlmCredential = async (): Promise<void> => {
    const apiKey = keyInput.trim()
    if (!apiKey) return
    const credential = await window.api.llm.saveCredential(activeProvider, apiKey)
    setProviderSettings((previous) => ({
      ...previous,
      [activeProvider]: { ...previous[activeProvider], credential },
    }))
    setKeyInput('')
    setEditingKey(false)
    await loadModels(activeProvider)
  }

  const forgetLlmCredential = async (): Promise<void> => {
    const credential = await window.api.llm.forgetCredential(activeProvider)
    setProviderSettings((previous) => ({
      ...previous,
      [activeProvider]: { ...previous[activeProvider], credential },
    }))
    setKeyInput('')
    setEditingKey(false)
    setModelOptions([])
    setModelsState(credential.configured ? 'idle' : 'missing-key')
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
    setProjectCredentialSaveState('saving')
    setProjectApplyError('')
    setProjectActionBusy(true)
    try {
      const status = await window.api.projectAwareness.saveCredential(projectCredentialInput)
      setProjectStatus(status)
      setProjectCredentialInput('')
      setProjectForgetConfirmation(false)
      setProjectCredentialSaveState('saved')
    } catch (error) {
      setProjectApplyError(projectActionError(error))
      setProjectCredentialSaveState('failed')
    } finally {
      setProjectStatus(await window.api.projectAwareness.getStatus())
      setProjectActionBusy(false)
    }
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

  const connectProject = async (): Promise<void> => {
    await runProjectAction(async () => {
      const configured = await window.api.projectAwareness.configure({
        enabled: true,
        provider: 'github',
        repository: projectRepository.trim(),
        branch: projectBranch.trim(),
      })
      setProjectEnabled(true)
      setProjectStatus(configured)
      await window.api.projectAwareness.connect()
    })
  }

  const recordMicrophoneTest = async (): Promise<void> => {
    const sequence = ++microphoneTestSequence.current
    setMicrophoneTestState('recording')
    setMicrophoneLevel(0)
    microphoneTestRecording.current = null
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let recorder: MediaRecorder | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio:
          micId && micId !== defaultSettingsForm.microphoneId
            ? { deviceId: { exact: micId } }
            : true,
      })
      context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      context.createMediaStreamSource(stream).connect(analyser)
      const chunks: BlobPart[] = []
      recorder = new MediaRecorder(stream)
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      })
      const stopped = new Promise<void>((resolve, reject) => {
        recorder?.addEventListener('stop', () => resolve(), { once: true })
        recorder?.addEventListener(
          'error',
          () => reject(new Error('Microphone recording failed')),
          { once: true },
        )
      })
      recorder.start()
      const samples = new Uint8Array(analyser.fftSize)
      const deadline = performance.now() + 3000
      while (performance.now() < deadline) {
        analyser.getByteTimeDomainData(samples)
        const peak = samples.reduce((value, sample) => Math.max(value, Math.abs(sample - 128)), 0)
        setMicrophoneLevel(Math.min(100, Math.round((peak / 128) * 100)))
        await new Promise((resolve) => window.setTimeout(resolve, 80))
      }
      recorder.stop()
      await stopped
      const recording = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer()
      if (recording.byteLength === 0) throw new Error('Microphone recording is empty')
      if (sequence !== microphoneTestSequence.current) return
      microphoneTestRecording.current = recording
      setMicrophoneTestState('ready')
    } catch {
      if (sequence === microphoneTestSequence.current) setMicrophoneTestState('capture-error')
    } finally {
      if (recorder?.state === 'recording') recorder.stop()
      stream?.getTracks().forEach((track) => {
        track.stop()
      })
      if (context) await context.close()
      setMicrophoneLevel(0)
    }
  }

  const playMicrophoneTest = async (): Promise<void> => {
    const recording = microphoneTestRecording.current
    if (!recording) return
    const sequence = ++microphoneTestSequence.current
    setMicrophoneTestState('playing')
    try {
      await controller.playMicrophonePreview(recording)
      if (sequence === microphoneTestSequence.current) setMicrophoneTestState('ready')
    } catch {
      if (sequence === microphoneTestSequence.current) setMicrophoneTestState('playback-error')
    }
  }

  const persistPatch = useCallback(
    async (partial: Partial<AppSettings>, applyOverlay = false): Promise<void> => {
      const sequence = ++saveSequence.current
      setSaveState('saving')
      const result = await window.api.config.save(partial)
      if (!result.ok) throw new Error(result.error)
      if (applyOverlay) {
        await window.api.overlay.applySettings()
        const overlay = await window.api.overlay.isVisible()
        onOverlayVisibleChange(Boolean(overlay.visible))
      }
      if (sequence === saveSequence.current) {
        setSaveState('saved')
        if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current)
        saveStatusTimer.current = window.setTimeout(() => setSaveState('idle'), 1800)
      }
    },
    [onOverlayVisibleChange],
  )

  // Each effect persists one domain patch. Overlay application is intentionally
  // limited to avatar/overlay changes.
  useEffect(() => {
    if (!hydrated.current || !isOpen) return
    const timer = window.setTimeout(() => {
      void persistPatch({ uiLocale }).catch(() => setSaveState('error'))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [uiLocale, isOpen, persistPatch])

  useEffect(() => {
    if (!hydrated.current || !isOpen) return
    const timer = window.setTimeout(() => {
      void persistPatch({
        ttsVoice: currentTtsVoice,
        ttsLanguage: lang,
        ttsEngine: 'f5',
      }).catch(() => setSaveState('error'))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [currentTtsVoice, lang, isOpen, persistPatch])

  useEffect(() => {
    if (!hydrated.current || !isOpen) return
    const timer = window.setTimeout(() => {
      void persistPatch({
        llm: {
          activeProvider,
          providers: providerSettings,
          roles: { backlogSelector: backlogRole },
        },
      }).catch(() => setSaveState('error'))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [activeProvider, providerSettings, backlogRole, isOpen, persistPatch])

  useEffect(() => {
    if (!hydrated.current || !isOpen) return
    const timer = window.setTimeout(() => {
      void persistPatch(
        {
          overlayWidth: String(clampNumber(overlayWidth, 250, 2000)),
          overlayHeight: String(clampNumber(overlayHeight, 250, 2000)),
          overlayMargin: String(clampNumber(overlayMargin, 0, 500)),
          overlayOpacity: String(clampNumber(overlayOpacityPercent, 0, 100) / 100),
          overlayTransparentBackground: overlayTransparentBackground ? 'true' : 'false',
          overlayCorner,
          overlayScale: String(clampNumber(overlayScalePercent, 50, 200) / 100),
          overlayViewMode,
          overlayClickThrough: overlayClickThrough ? 'true' : 'false',
        },
        true,
      ).catch(() => setSaveState('error'))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [
    overlayWidth,
    overlayHeight,
    overlayMargin,
    overlayOpacityPercent,
    overlayTransparentBackground,
    overlayClickThrough,
    overlayCorner,
    overlayScalePercent,
    overlayViewMode,
    isOpen,
    persistPatch,
  ])

  useEffect(() => {
    if (!hydrated.current || !isOpen) return
    const timer = window.setTimeout(() => {
      void persistPatch({
        pythonSpeechUrl: speechUrl,
        developerModeEnabled: developerModeEnabled ? 'true' : 'false',
        developerOverlayAnimationHudEnabled: developerOverlayAnimationHudEnabled ? 'true' : 'false',
      }).catch(() => setSaveState('error'))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [speechUrl, developerModeEnabled, developerOverlayAnimationHudEnabled, isOpen, persistPatch])

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
        credentialSaveState: projectCredentialSaveState,
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
        connect: connectProject,
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
        voiceWarmup,
        continuousListeningState,
        microphoneTestState,
        microphoneLevel,
      },
      actions: {
        setSpeechUrl,
        setLanguage: setLang,
        setCurrentTtsVoice,
        setMicrophoneId: (id) => {
          setMicId(id)
          controller.setMicrophone(id === defaultSettingsForm.microphoneId ? '' : id)
        },
        recordMicrophoneTest,
        playMicrophoneTest,
        toggleContinuousListening: onToggleContinuousListening,
      },
    },
    llm: {
      state: {
        providers,
        activeProvider,
        providerSettings,
        models: modelOptions,
        modelsState,
        editingKey,
        keyInput,
        backlogRole,
        backlogModels,
        selectedModel,
        health: llmHealth,
      },
      actions: {
        setActiveProvider,
        updateProviderSettings,
        setEditingKey,
        setKeyInput,
        saveCredential: saveLlmCredential,
        forgetCredential: forgetLlmCredential,
        loadModels,
        setBacklogRole,
      },
    },
    avatar: {
      state: {
        vrmName,
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
      state: {
        developerModeEnabled,
        developerOverlayAnimationHudEnabled,
        speechUrl,
        backlogRole,
        providers,
        providerSettings,
        backlogModels,
      },
      actions: {
        setDeveloperModeEnabled: applyDeveloperModeEnabled,
        setDeveloperOverlayAnimationHudEnabled,
        setSpeechUrl,
        setBacklogRole,
      },
    },
  }
}
