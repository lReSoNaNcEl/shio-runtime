import { Provider, Text } from '@react-spectrum/s2'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type CapabilityNavigationTarget } from '../../shared/capabilities'
import { normalizeUiTheme, type UiTheme } from '../../shared/config'
import { type PluginId } from '../../shared/plugins'
import { controller } from '../Controller'
import { useCapabilities } from '../hooks/useCapabilities'
import { useControllerState } from '../hooks/useControllerState'
import { useRuntimeSupportBundle } from '../hooks/useRuntimeSupportBundle'
import { useTranslation } from '../localization/useTranslation'
import { observeRendererPromise } from '../reliability/observePromise'
import { buildRuntimeHealthProjection } from '../runtime/runtimeHealth'
import { ActionRuntimeHost } from './actions/ActionRuntimeHost'
import { ChatOverlay, type ChatOverlayHandle } from './chat/ChatOverlay'
import { NewConversationButton } from './chat/NewConversationButton'
import { NewConversationDialog } from './chat/NewConversationDialog'
import { ListeningControl } from './controls/ListeningControl'
import { OverlayCameraControl } from './controls/OverlayCameraControl'
import { pluginIdForNavigationTarget } from './navigation/capabilityNavigation'
import { MicrophoneGateOverlay } from './overlays/MicrophoneGateOverlay'
import { MissingVrmDialog } from './overlays/MissingVrmDialog'
import { PluginsView } from './plugins/PluginsView'
import { SettingsDialog } from './settings/SettingsDialog'
import { type SettingsSection } from './settings/state/settingsContracts'
import { SetupCenter } from './setup/SetupCenter'
import { type AppSection, AppShell, SectionHeading } from './shell/AppShell'
import { AvatarPreviewView } from './views/AvatarPreviewView'
import { CapabilitiesView } from './views/CapabilitiesView'
import { DiagnosticsView } from './views/DiagnosticsView'
import { MemoryView } from './views/MemoryView'
import { TasksView } from './views/TasksView'

export function App() {
  const { intlLocale, t } = useTranslation()
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const state = useControllerState()
  const [section, setSection] = useState<AppSection>('chat')
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>('general')
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false)
  const [uiTheme, setUiTheme] = useState<UiTheme>('light')
  const [setupOpen, setSetupOpen] = useState(false)
  const [speechToast, setSpeechToast] = useState<string | null>(null)
  const [newConversationDialogOpen, setNewConversationDialogOpen] = useState(false)
  const [newConversationPending, setNewConversationPending] = useState(false)
  const [newConversationError, setNewConversationError] = useState<string | null>(null)
  const [missingVrmDialogOpen, setMissingVrmDialogOpen] = useState(false)
  const [pluginDetails, setPluginDetails] = useState<PluginId | null>(null)
  const chatOverlayRef = useRef<ChatOverlayHandle>(null)
  const prevSpeechService = useRef(state.speechCapabilities.service)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isOverlay = useMemo(
    () => new URLSearchParams(window.location.search).get('overlay') === '1',
    [],
  )
  const runtimeSupport = useRuntimeSupportBundle(!isOverlay)
  const capabilities = useCapabilities(!isOverlay)
  const runtimeHealth = useMemo(
    () => buildRuntimeHealthProjection(state, runtimeSupport.bundle),
    [runtimeSupport.bundle, state],
  )
  const runtimeHealthLabel = t(
    runtimeHealth.recentIncidents.length > 0
      ? 'systemStatus.incident.shell'
      : runtimeHealth.overall === 'healthy'
        ? 'health.shell.healthy'
        : runtimeHealth.overall === 'notice'
          ? 'health.shell.notice'
          : 'health.shell.error',
  )
  const refreshOverlayVisibility = useCallback(() => {
    observeRendererPromise(controller.refreshOverlayVisibility(), 'refresh Overlay visibility')
  }, [])

  // One unobtrusive, auto-dismissing toast when the Speech API recovers (ТЗ §9).
  const speechService = state.speechCapabilities.service
  useEffect(() => {
    const prev = prevSpeechService.current
    prevSpeechService.current = speechService
    if ((prev === 'unavailable' || prev === 'degraded') && speechService === 'available') {
      setSpeechToast(t('app.speechRecovered'))
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setSpeechToast(null), 4000)
    }
  }, [speechService, t])

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (isOverlay) {
      let active = true
      observeRendererPromise(
        window.overlayApi.config.get().then((config) => {
          if (active) setUiTheme(normalizeUiTheme(config.uiTheme))
        }),
        'load Overlay theme',
      )
      const unsubscribe = window.overlayApi.config.onUpdated((config) => {
        if (active) setUiTheme(normalizeUiTheme(config.uiTheme))
      })
      return () => {
        active = false
        unsubscribe()
      }
    }
    observeRendererPromise(
      window.api.config.get().then((config) => {
        setDeveloperModeEnabled(config.developerModeEnabled === 'true')
        setUiTheme(normalizeUiTheme(config.uiTheme))
        setSetupOpen(!config.setup.completed)
      }),
      'load App configuration',
    )
    return window.api.config.onUpdated((config) => {
      setDeveloperModeEnabled(config.developerModeEnabled === 'true')
      setUiTheme(normalizeUiTheme(config.uiTheme))
    })
  }, [isOverlay])

  useEffect(() => {
    document.documentElement.dataset.theme = uiTheme
    document.documentElement.style.colorScheme = uiTheme
  }, [uiTheme])

  useEffect(() => {
    const openSetup = () => {
      setSection('chat')
      setSetupOpen(true)
    }
    window.addEventListener('shio:open-setup', openSetup)
    return () => window.removeEventListener('shio:open-setup', openSetup)
  }, [])

  useEffect(() => {
    if (!developerModeEnabled && section === 'avatar') setSection('chat')
  }, [developerModeEnabled, section])
  useEffect(() => {
    document.documentElement.classList.toggle('overlay-window', isOverlay)
    document.body.classList.toggle('overlay-window', isOverlay)
    if (isOverlay && overlayCanvasRef.current) {
      observeRendererPromise(
        controller.attachCanvas(overlayCanvasRef.current).then(() => {
          controller.subscribeOverlayUpdates()
        }),
        'bootstrap Overlay renderer',
      )
    } else if (!isOverlay) {
      observeRendererPromise(controller.bootstrap(), 'bootstrap main renderer')
    }
    return () => controller.dispose()
  }, [isOverlay])

  const sectionCopy: Record<AppSection, { title: string; subtitle?: string }> = {
    chat: { title: t('app.nav.chat') },
    capabilities: {
      title: t('app.nav.capabilities'),
      subtitle: t('app.section.capabilities.subtitle'),
    },
    memory: {
      title: t('app.section.memory.title'),
      subtitle: t('app.section.memory.subtitle'),
    },
    tasks: {
      title: t('app.section.tasks.title'),
      subtitle: t('app.section.tasks.subtitle'),
    },
    avatar: {
      title: t('app.section.avatar.title'),
      subtitle: t('app.section.avatar.subtitle'),
    },
    plugins: {
      title: t('app.section.plugins.title'),
      subtitle: t('app.section.plugins.subtitle'),
    },
    debug: {
      title: t('app.section.diagnostics.title'),
      subtitle: t('app.section.diagnostics.subtitle'),
    },
    settings: { title: t('app.nav.settings'), subtitle: t('app.section.settings.subtitle') },
  }
  const copy = sectionCopy[section]
  const activeResponse = ['thinking', 'synthesizing', 'speaking'].includes(state.status)
  const newConversationDisabled =
    state.status === 'listening' ||
    state.status === 'recognizing' ||
    state.microphoneGate.status !== 'closed' ||
    newConversationPending

  const startNewConversation = async (): Promise<void> => {
    if (newConversationPending) return
    setNewConversationPending(true)
    setNewConversationError(null)
    try {
      const chatOverlay = chatOverlayRef.current
      if (!chatOverlay) throw new Error('Chat overlay is unavailable')
      await chatOverlay.startNewConversation()
      setNewConversationDialogOpen(false)
    } catch {
      setNewConversationError(t('chat.newConversation.error'))
      setNewConversationDialogOpen(true)
    } finally {
      setNewConversationPending(false)
    }
  }

  const requestNewConversation = (): void => {
    if (section !== 'chat') setSection('chat')
    if (state.messages.length > 0 || activeResponse) {
      setNewConversationError(null)
      setNewConversationDialogOpen(true)
      return
    }
    observeRendererPromise(startNewConversation(), 'start new conversation')
  }
  const showNewConversationAction = state.messages.length > 0 || activeResponse

  const navigateToCapabilityTarget = (target: CapabilityNavigationTarget): void => {
    if (target.kind === 'settings') {
      if (['general', 'speech', 'llm', 'avatar', 'advanced'].includes(target.id)) {
        setSettingsInitialSection(target.id as SettingsSection)
      }
      setSection('settings')
      return
    }
    if (target.kind === 'plugin') {
      const pluginId = pluginIdForNavigationTarget(target)
      if (pluginId) setPluginDetails(pluginId)
      setSection('plugins')
      return
    }
    const views: AppSection[] = ['chat', 'capabilities', 'memory', 'tasks', 'plugins']
    if (views.includes(target.id as AppSection)) setSection(target.id as AppSection)
  }

  const setOverlayVisible = async (visible: boolean): Promise<void> => {
    if (visible && !state.vrmConfigured) {
      setMissingVrmDialogOpen(true)
      return
    }
    await controller.setOverlayVisible(visible)
  }

  const changeUiTheme = (nextTheme: UiTheme): void => {
    const previousTheme = uiTheme
    setUiTheme(nextTheme)
    observeRendererPromise(
      window.api.config.save({ uiTheme: nextTheme }).then((result) => {
        if (!result.ok) throw new Error(result.error ?? 'Theme setting could not be saved')
      }),
      'save UI theme',
      () => setUiTheme(previousTheme),
    )
  }

  if (isOverlay)
    return (
      <Provider colorScheme={uiTheme} locale={intlLocale} UNSAFE_className="app-provider">
        <canvas id="canvas" ref={overlayCanvasRef} />
        {state.overlayAnimationHudEnabled && state.overlayMotionProfileId && (
          <div className="overlay-animation-hud">
            <Text>{state.overlayMotionProfileId}</Text>
          </div>
        )}
      </Provider>
    )

  return (
    <Provider colorScheme={uiTheme} locale={intlLocale} UNSAFE_className="app-provider">
      <AppShell
        section={section}
        onSectionChange={(nextSection) => {
          if (setupOpen) setSetupOpen(false)
          if (nextSection === 'settings') setSettingsInitialSection('general')
          if (nextSection === 'plugins') setPluginDetails(null)
          setSection(nextSection)
        }}
        health={{ state: runtimeHealth.overall, text: runtimeHealthLabel }}
        runtimeHealth={runtimeHealth}
        systemStatusActions={{
          openDiagnostics: () => setSection('debug'),
          openSpeechSettings: () => {
            setSettingsInitialSection('speech')
            setSection('settings')
          },
          openLlmSettings: () => {
            setSettingsInitialSection('llm')
            setSection('settings')
          },
          openPlugin: (pluginId) => {
            setPluginDetails(pluginId)
            setSection('plugins')
          },
          copyReport: async () => {
            const report = await runtimeSupport.refresh()
            await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
          },
        }}
        developerModeEnabled={developerModeEnabled}
        hideHeader={setupOpen}
        contentClassName={setupOpen ? 'setup-layer' : undefined}
        heading={
          !setupOpen ? <SectionHeading title={copy.title} subtitle={copy.subtitle} /> : undefined
        }
        sidebarAction={
          !setupOpen && showNewConversationAction ? (
            <NewConversationButton
              isDisabled={newConversationDisabled}
              onPress={requestNewConversation}
            />
          ) : undefined
        }
        headerAction={
          section === 'chat' && !setupOpen ? (
            <div className="chat-header-controls">
              {showNewConversationAction && (
                <div className="chat-mobile-new-conversation">
                  <NewConversationButton
                    isDisabled={newConversationDisabled}
                    onPress={requestNewConversation}
                  />
                </div>
              )}
              <ListeningControl
                projection={state.continuousListening}
                onToggle={() =>
                  observeRendererPromise(
                    controller.toggleContinuousListening(),
                    'toggle continuous listening',
                  )
                }
              />
              <OverlayCameraControl
                overlayState={state.overlayState}
                cameraMode={state.overlayCameraMode}
                vrmConfigured={state.vrmConfigured}
                onToggle={() => setOverlayVisible(state.overlayState !== 'on')}
                onCameraModeChange={(mode) => controller.setOverlayViewMode(mode)}
              />
            </div>
          ) : undefined
        }
      >
        {section === 'chat' && (
          <>
            {setupOpen ? (
              <SetupCenter
                state={state}
                onClose={() => setSetupOpen(false)}
                onComplete={() => setSetupOpen(false)}
                onOpenPlugins={() => {
                  setSetupOpen(false)
                  setSection('plugins')
                }}
                onToggleOverlay={async (visible) => {
                  await setOverlayVisible(visible)
                }}
              />
            ) : (
              <ChatOverlay
                ref={chatOverlayRef}
                state={state}
                capabilitySnapshot={capabilities.snapshot}
                gateOpen={state.microphoneGate.status !== 'closed'}
                onOpenCapabilities={() => setSection('capabilities')}
                onOpenSpeechSettings={() => {
                  setSettingsInitialSection('speech')
                  setSection('settings')
                }}
                onOpenLlmSettings={() => {
                  setSettingsInitialSection('llm')
                  setSection('settings')
                }}
              />
            )}
            <MicrophoneGateOverlay
              state={state.microphoneGate}
              onDeviceSelect={(id) => controller.selectMicrophoneGateDevice(id)}
              onRefresh={() => controller.refreshMicrophoneGateDevices()}
              onContinue={() => controller.continueMicrophoneGate()}
              onCancel={() => controller.cancelMicrophoneGate()}
            />
          </>
        )}
        {section === 'avatar' && (
          <AvatarPreviewView
            onOpenSettings={() => {
              setSettingsInitialSection('avatar')
              setSection('settings')
            }}
          />
        )}
        {section === 'capabilities' && (
          <CapabilitiesView
            snapshot={capabilities.snapshot}
            error={capabilities.error}
            onRefresh={capabilities.refresh}
            onNavigate={navigateToCapabilityTarget}
          />
        )}
        {section === 'memory' && <MemoryView aliveSnapshot={state.alive} />}
        {section === 'tasks' && (
          <TasksView
            snapshot={state.alive}
            onOpenChat={() => setSection('chat')}
            onOpenAutonomySettings={() => {
              setSettingsInitialSection('autonomy')
              setSection('settings')
            }}
          />
        )}
        {section === 'plugins' && (
          <PluginsView
            detailPluginId={pluginDetails}
            onShowDetails={setPluginDetails}
            onBack={() => setPluginDetails(null)}
            onOpenLlmSettings={() => {
              setSettingsInitialSection('llm')
              setSection('settings')
            }}
          />
        )}
        {section === 'debug' && <DiagnosticsView />}
        {section === 'settings' && (
          <SettingsDialog
            isOpen
            initialSection={settingsInitialSection}
            aliveSnapshot={state.alive}
            uiTheme={uiTheme}
            onThemeChange={changeUiTheme}
            vrmLoaded={state.vrmLoaded}
            faceTrackingEnabled={state.faceTrackingEnabled}
            onToggleFaceTracking={() => controller.toggleFaceTracking()}
            overlayVisible={state.overlayState === 'on'}
            overlayViewModeProjection={state.overlayCameraMode}
            llmHealth={state.llmHealth}
            voiceWarmup={state.voiceWarmup}
            continuousListening={state.continuousListening}
            onOverlayVisibleChange={refreshOverlayVisibility}
            onToggleOverlay={setOverlayVisible}
            onClose={() => setSection('chat')}
          />
        )}
      </AppShell>
      {speechToast && (
        <div className="speech-toast" role="status" aria-live="polite">
          {speechToast}
        </div>
      )}
      <NewConversationDialog
        isOpen={newConversationDialogOpen}
        isPending={newConversationPending}
        error={newConversationError}
        onConfirm={() => observeRendererPromise(startNewConversation(), 'confirm new conversation')}
        onDismiss={() => {
          if (newConversationPending) return
          setNewConversationDialogOpen(false)
          setNewConversationError(null)
        }}
      />
      <MissingVrmDialog
        isOpen={missingVrmDialogOpen}
        onDismiss={() => setMissingVrmDialogOpen(false)}
        onOpenSettings={() => {
          setMissingVrmDialogOpen(false)
          setSettingsInitialSection('avatar')
          setSection('settings')
        }}
      />
      <ActionRuntimeHost />
    </Provider>
  )
}
