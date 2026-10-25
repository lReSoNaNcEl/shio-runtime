import { useCallback, useEffect, useRef, useState } from 'react'

import type { AppSettings } from '../../../../shared/config'
import type { LlmProviderId } from '../../../../shared/llm'
import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'
import { controller } from '../../../Controller'
import { observeRendererPromise } from '../../../reliability/observePromise'
import type {
  SettingsDialogViewModel,
  SettingsSaveState,
  SettingsSection,
} from './settingsContracts'
import {
  defaultBacklogSelectorRole,
  defaultComputerUseVisionRole,
  defaultSettingsForm,
  overlayDefaults,
} from './settingsDefaults'
import {
  clampNumber,
  deduplicateModelsById,
  parseNumberSetting,
  parseOverlayViewMode,
} from './settingsParsers'
import { useAiSettings } from './useAiSettings'
import { useAvatarSettings } from './useAvatarSettings'
import { useDeveloperSettings } from './useDeveloperSettings'
import { useGeneralSettings } from './useGeneralSettings'
import { useSettingsNavigation } from './useSettingsNavigation'
import { useVoiceSettings } from './useVoiceSettings'

interface SettingsDialogStateOptions {
  isOpen: boolean
  initialSection: SettingsSection
  overlayVisible: boolean
  overlayViewModeProjection: OverlayViewMode
  llmHealth: SettingsDialogViewModel['llm']['state']['health']
  voiceWarmup: SettingsDialogViewModel['speech']['state']['voiceWarmup']
  continuousListening: SettingsDialogViewModel['speech']['state']['continuousListening']
  onOverlayVisibleChange: (visible: boolean) => void
  onToggleOverlay: (visible: boolean) => void | Promise<void>
}

function validAccountId(accountId: string): boolean {
  return /^[a-f0-9]{32}$/iu.test(accountId.trim())
}

export function useSettingsDialogState({
  isOpen,
  initialSection,
  overlayVisible,
  overlayViewModeProjection,
  llmHealth,
  voiceWarmup,
  continuousListening,
  onOverlayVisibleChange,
  onToggleOverlay,
}: SettingsDialogStateOptions): SettingsDialogViewModel {
  const { activeSection, setActiveSection } = useSettingsNavigation(isOpen, initialSection)
  const hydrated = useRef(false)
  const saveSequence = useRef(0)
  const saveStatusTimer = useRef<number | null>(null)
  const microphoneTestSequence = useRef(0)
  const microphoneTestRecording = useRef<ArrayBuffer | null>(null)
  const microphoneTestCleanup = useRef<() => void>(() => undefined)
  const modelRequestSequence = useRef(0)
  const [saveState, setSaveState] = useState<SettingsSaveState>('idle')
  const { uiLocale, setUiLocale } = useGeneralSettings()
  const {
    developerModeEnabled,
    developerOverlayAnimationHudEnabled,
    setDeveloperModeEnabled,
    setDeveloperOverlayAnimationHudEnabledState,
  } = useDeveloperSettings()
  const {
    lang,
    microphoneLevel,
    microphoneTestState,
    micId,
    mics,
    setLang,
    setMicrophoneLevel,
    setMicrophoneTestState,
    setMicId,
    setMics,
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
    setAvatarName,
    avatarName,
  } = useAvatarSettings()
  const {
    activeProvider,
    backlogModels,
    backlogRole,
    computerUseVisionRole,
    editingKey,
    keyInput,
    modelOptions,
    modelsState,
    providers,
    providerSettings,
    setActiveProvider,
    setBacklogModels,
    setBacklogRole,
    setComputerUseVisionRole,
    setEditingKey,
    setKeyInput,
    setModelOptions,
    setModelsState,
    setProviders,
    setProviderSettings,
  } = useAiSettings()
  const activeProviderRef = useRef(activeProvider)
  activeProviderRef.current = activeProvider

  // biome-ignore lint/correctness/useExhaustiveDependencies: domain hooks expose stable React state setters.
  useEffect(() => {
    setOverlayViewMode(overlayViewModeProjection)
  }, [overlayViewModeProjection])

  useEffect(
    () => () => {
      if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current)
      microphoneTestSequence.current += 1
      microphoneTestRecording.current = null
      microphoneTestCleanup.current()
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
    let active = true
    observeRendererPromise(
      (async () => {
        const cfg = await window.api.config.get()
        if (!active) return
        setActiveSection(initialSection)
        setLang(cfg.ttsLanguage ?? defaultSettingsForm.ttsLanguage)
        setUiLocale(cfg.uiLocale)
        setDeveloperModeEnabled(cfg.developerModeEnabled === 'true')
        setDeveloperOverlayAnimationHudEnabledState(
          cfg.developerOverlayAnimationHudEnabled !== 'false',
        )
        setEditingKey(false)
        setKeyInput('')
        setActiveProvider(cfg.llm?.activeProvider ?? 'groq')
        setProviderSettings(cfg.llm.providers)
        setBacklogRole(cfg.llm?.roles?.backlogSelector ?? defaultBacklogSelectorRole)
        setComputerUseVisionRole(cfg.llm?.roles?.computerUseVision ?? defaultComputerUseVisionRole)
        setAvatarName(cfg.avatarAssetName)
        setOverlayWidth(parseNumberSetting(cfg.overlayWidth, overlayDefaults.width, 250, 2000))
        setOverlayHeight(parseNumberSetting(cfg.overlayHeight, overlayDefaults.height, 250, 2000))
        setOverlayMargin(parseNumberSetting(cfg.overlayMargin, overlayDefaults.margin, 0, 500))
        setOverlayOpacityPercent(Math.round(parseNumberSetting(cfg.overlayOpacity, 1, 0, 1) * 100))
        setOverlayTransparentBackground(cfg.overlayTransparentBackground !== 'false')
        setOverlayClickThrough(cfg.overlayClickThrough !== 'false')
        setOverlayCorner(cfg.overlayCorner ?? overlayDefaults.corner)
        setOverlayScalePercent(Math.round(parseNumberSetting(cfg.overlayScale, 1, 0.5, 2) * 100))
        setOverlayViewMode(parseOverlayViewMode(cfg.overlayViewMode))
        const availableProviders = await window.api.llm.providers()
        if (!active) return
        setProviders(availableProviders)
        const availableMicrophones = await controller.listMicrophones()
        if (!active) return
        setMics(availableMicrophones)
        setMicId(controller.getMicrophoneId() || defaultSettingsForm.microphoneId)
        hydrated.current = true
      })(),
      'hydrate Settings dialog',
    )
    return () => {
      active = false
    }
  }, [initialSection, isOpen])

  const selectedModel = providerSettings[activeProvider]?.model ?? ''
  const activeAccountId = providerSettings[activeProvider]?.accountId ?? ''
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

  const updateProviderAccountId = (id: LlmProviderId, accountId: string): void => {
    modelRequestSequence.current += 1
    setModelOptions([])
    setModelsState(validAccountId(accountId) ? 'idle' : 'missing-account-id')
    setProviderSettings((previous) => {
      const base = previous[id]
      return { ...previous, [id]: { ...base, accountId } }
    })
  }

  const loadModels = async (providerId: LlmProviderId): Promise<void> => {
    const profile = providers.find((provider) => provider.id === providerId)
    const accountId = providerSettings[providerId]?.accountId ?? ''
    if (profile?.requiresAccountId && !validAccountId(accountId)) {
      setModelOptions([])
      setModelsState('missing-account-id')
      return
    }
    const requestSequence = ++modelRequestSequence.current
    setModelsState('loading')
    const result = await window.api.llm.fetchModels(providerId, accountId)
    if (
      requestSequence !== modelRequestSequence.current ||
      activeProviderRef.current !== providerId
    ) {
      return
    }
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
        : result.kind === 'access'
          ? 'access-error'
          : result.kind === 'configuration'
            ? 'missing-account-id'
            : 'network-error',
    )
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: preserved debounce trigger semantics; loadModels is intentionally excluded.
  useEffect(() => {
    if (!isOpen) return
    const profile = providers.find((provider) => provider.id === activeProvider)
    if (profile?.requiresAccountId && !validAccountId(activeAccountId)) {
      modelRequestSequence.current += 1
      setModelOptions([])
      setModelsState('missing-account-id')
      return
    }
    if (profile?.modelsRequireApiKey && !activeCredentialConfigured) {
      modelRequestSequence.current += 1
      setModelOptions([])
      setModelsState('missing-key')
      return
    }
    const timer = window.setTimeout(() => {
      observeRendererPromise(loadModels(activeProvider), 'load active-provider models')
    }, 400)
    return () => {
      modelRequestSequence.current += 1
      window.clearTimeout(timer)
    }
  }, [isOpen, activeProvider, activeAccountId, activeCredentialConfigured, providers])

  // biome-ignore lint/correctness/useExhaustiveDependencies: AI domain setters are stable React state setters.
  useEffect(() => {
    if (!isOpen || !backlogRole.enabled || !backlogRole.providerId) {
      setBacklogModels([])
      return
    }
    const profile = providers.find((provider) => provider.id === backlogRole.providerId)
    const backlogAccountId = providerSettings[backlogRole.providerId]?.accountId ?? ''
    if (profile?.requiresAccountId && !validAccountId(backlogAccountId)) {
      setBacklogModels([])
      return
    }
    if (profile?.modelsRequireApiKey && !backlogCredentialConfigured) {
      setBacklogModels([])
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      observeRendererPromise(
        window.api.llm
          .fetchModels(backlogRole.providerId as LlmProviderId, backlogAccountId)
          .then((result) => {
            if (current) {
              setBacklogModels(result.ok ? deduplicateModelsById(result.models ?? []) : [])
            }
          }),
        'load backlog-selector models',
      )
    }, 400)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [
    isOpen,
    backlogRole.enabled,
    backlogRole.providerId,
    backlogCredentialConfigured,
    providerSettings,
    providers,
  ])

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

  const recordMicrophoneTest = async (): Promise<void> => {
    const sequence = ++microphoneTestSequence.current
    setMicrophoneTestState('recording')
    setMicrophoneLevel(0)
    microphoneTestRecording.current = null
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let recorder: MediaRecorder | null = null
    const cleanup = (): void => {
      if (recorder?.state === 'recording') recorder.stop()
      stream?.getTracks().forEach((track) => {
        track.stop()
      })
      stream = null
      if (context) {
        const currentContext = context
        context = null
        if (currentContext.state !== 'closed') {
          observeRendererPromise(currentContext.close(), 'close microphone test AudioContext')
        }
      }
      if (microphoneTestCleanup.current === cleanup) {
        microphoneTestCleanup.current = () => undefined
      }
    }
    microphoneTestCleanup.current = cleanup
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio:
          micId && micId !== defaultSettingsForm.microphoneId
            ? { deviceId: { exact: micId } }
            : true,
      })
      if (sequence !== microphoneTestSequence.current) return
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
      while (performance.now() < deadline && sequence === microphoneTestSequence.current) {
        analyser.getByteTimeDomainData(samples)
        const peak = samples.reduce((value, sample) => Math.max(value, Math.abs(sample - 128)), 0)
        setMicrophoneLevel(Math.min(100, Math.round((peak / 128) * 100)))
        await new Promise((resolve) => window.setTimeout(resolve, 80))
      }
      if (sequence !== microphoneTestSequence.current) return
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
      cleanup()
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
        ttsLanguage: lang,
        ttsEngine: 'fish-s2-pro',
      }).catch(() => setSaveState('error'))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [lang, isOpen, persistPatch])

  useEffect(() => {
    if (!hydrated.current || !isOpen) return
    const timer = window.setTimeout(() => {
      void persistPatch({
        llm: {
          activeProvider,
          providers: providerSettings,
          roles: {
            backlogSelector: backlogRole,
            computerUseVision: computerUseVisionRole,
          },
        },
      }).catch(() => setSaveState('error'))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [activeProvider, providerSettings, backlogRole, computerUseVisionRole, isOpen, persistPatch])

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
        developerModeEnabled: developerModeEnabled ? 'true' : 'false',
        developerOverlayAnimationHudEnabled: developerOverlayAnimationHudEnabled ? 'true' : 'false',
      }).catch(() => setSaveState('error'))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [developerModeEnabled, developerOverlayAnimationHudEnabled, isOpen, persistPatch])

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
    speech: {
      state: {
        language: lang,
        microphones: mics,
        microphoneId: micId,
        voiceWarmup,
        continuousListening,
        microphoneTestState,
        microphoneLevel,
      },
      actions: {
        setLanguage: setLang,
        setMicrophoneId: (id) => {
          setMicId(id)
          controller.setMicrophone(id === defaultSettingsForm.microphoneId ? '' : id)
        },
        recordMicrophoneTest,
        playMicrophoneTest,
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
        updateProviderAccountId,
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
        avatarName,
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
        backlogRole,
        providers,
        providerSettings,
        backlogModels,
      },
      actions: {
        setDeveloperModeEnabled: applyDeveloperModeEnabled,
        setDeveloperOverlayAnimationHudEnabled,
        setBacklogRole,
      },
    },
  }
}
