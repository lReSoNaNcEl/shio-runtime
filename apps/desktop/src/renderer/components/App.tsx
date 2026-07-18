import { Provider } from '@react-spectrum/s2'
import { useEffect, useMemo, useRef, useState } from 'react'

import { controller } from '../Controller'
import { useTranslation } from '../localization/useTranslation'
import { ChatOverlay } from './ChatOverlay'
import { MicrophoneGateOverlay } from './MicrophoneGateOverlay'
import { OverlayCameraControl } from './OverlayCameraControl'
import { SettingsDialog } from './SettingsDialog'
import { StreamingModeControl } from './StreamingModeControl'
import { type AppSection, AppShell, SectionHeading } from './shell/AppShell'
import { useControllerState } from './useController'
import { AvatarPreviewView } from './views/AvatarPreviewView'
import { DiagnosticsView } from './views/DiagnosticsView'
import { RuntimeHealthView } from './views/RuntimeHealthView'

export function App(): React.JSX.Element {
  const { intlLocale, t } = useTranslation()
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const state = useControllerState()
  const [section, setSection] = useState<AppSection>('chat')
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false)
  const [speechToast, setSpeechToast] = useState<string | null>(null)
  const prevSpeechService = useRef(state.speechCapabilities.service)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    void window.api.config.get().then((config) => {
      setDeveloperModeEnabled(config.developerModeEnabled === 'true')
    })
    window.api.config.onUpdated((config) => {
      setDeveloperModeEnabled(config.developerModeEnabled === 'true')
    })
  }, [])

  useEffect(() => {
    if (!developerModeEnabled && section === 'debug') setSection('health')
  }, [developerModeEnabled, section])
  const isOverlay = useMemo(
    () => new URLSearchParams(window.location.search).get('overlay') === '1',
    [],
  )

  useEffect(() => {
    document.documentElement.classList.toggle('overlay-window', isOverlay)
    document.body.classList.toggle('overlay-window', isOverlay)
    if (isOverlay && overlayCanvasRef.current) {
      void controller.attachCanvas(overlayCanvasRef.current)
      controller.subscribeOverlayUpdates()
    } else if (!isOverlay) {
      void controller.bootstrap()
    }
  }, [isOverlay])

  const sectionCopy: Record<AppSection, { title: string; subtitle?: string }> = {
    chat: { title: t('app.nav.chat') },
    avatar: {
      title: t('app.section.avatar.title'),
      subtitle: t('app.section.avatar.subtitle'),
    },
    health: { title: t('app.nav.health'), subtitle: t('app.section.health.subtitle') },
    debug: {
      title: t('app.section.diagnostics.title'),
      subtitle: t('app.section.diagnostics.subtitle'),
    },
    settings: { title: t('app.nav.settings'), subtitle: t('app.section.settings.subtitle') },
  }
  const copy = sectionCopy[section]

  if (isOverlay)
    return (
      <Provider colorScheme="dark" locale={intlLocale} UNSAFE_className="app-provider">
        <canvas id="canvas" ref={overlayCanvasRef} />
        {state.overlayAnimationHudEnabled && state.overlayAnimationFile && (
          <div className="overlay-animation-hud">{state.overlayAnimationFile}</div>
        )}
      </Provider>
    )

  return (
    <Provider colorScheme="dark" locale={intlLocale} UNSAFE_className="app-provider">
      <AppShell
        section={section}
        onSectionChange={setSection}
        health={state.health}
        developerModeEnabled={developerModeEnabled}
        headerAction={
          section === 'chat' ? (
            <div className="chat-header-controls">
              <StreamingModeControl
                mode={state.continuousListeningMode}
                listeningState={state.continuousListeningState}
                onToggle={() => void controller.toggleContinuousListening()}
                onModeChange={(mode) => void controller.setContinuousListeningMode(mode)}
              />
              <OverlayCameraControl
                overlayState={state.overlayState}
                cameraMode={state.overlayCameraMode}
                onToggle={() => controller.toggleOverlay()}
                onCameraModeChange={(mode) => controller.setOverlayViewMode(mode)}
              />
            </div>
          ) : undefined
        }
      >
        <SectionHeading title={copy.title} subtitle={copy.subtitle} />
      </AppShell>
      <div className="section-content">
        {section === 'chat' && (
          <>
            <ChatOverlay
              state={state}
              gateOpen={state.microphoneGate.status !== 'closed'}
              onOpenHealth={() => setSection('health')}
            />
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
          <AvatarPreviewView onOpenSettings={() => setSection('settings')} />
        )}
        {section === 'health' && (
          <RuntimeHealthView
            state={state}
            onRetry={() => {
              void controller.checkHealth()
              void controller.checkLlmHealth()
            }}
          />
        )}
        {section === 'debug' && developerModeEnabled && <DiagnosticsView />}
        {section === 'settings' && (
          <SettingsDialog
            isOpen
            continuousListeningMode={state.continuousListeningMode}
            vrmLoaded={state.vrmLoaded}
            faceTrackingEnabled={state.faceTrackingEnabled}
            passiveCompanionEnabled={state.passiveCompanionEnabled}
            onToggleFaceTracking={() => controller.toggleFaceTracking()}
            onPassiveCompanionChange={(enabled) => controller.setPassiveCompanionMode(enabled)}
            overlayVisible={state.overlayState === 'on'}
            overlayViewModeProjection={state.overlayCameraMode}
            llmHealth={state.llmHealth}
            onOverlayVisibleChange={() => void controller.refreshOverlayVisibility()}
            onToggleOverlay={(visible) => controller.setOverlayVisible(visible)}
            onClose={() => setSection('chat')}
          />
        )}
      </div>
      {speechToast && (
        <div className="speech-toast" role="status" aria-live="polite">
          {speechToast}
        </div>
      )}
    </Provider>
  )
}
