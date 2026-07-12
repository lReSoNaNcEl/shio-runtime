import { useEffect, useMemo, useRef, useState } from 'react'
import { Provider, Button } from '@react-spectrum/s2'
import { controller } from '../Controller'
import { useControllerState } from './useController'
import { ChatOverlay } from './ChatOverlay'
import { SettingsDialog } from './SettingsDialog'
import { AvatarDebugDialog } from './AvatarDebugDialog'
import { StreamingModeControl } from './StreamingModeControl'
import { MicrophoneGateOverlay } from './MicrophoneGateOverlay'
import { OverlayCameraControl } from './OverlayCameraControl'
import { AppShell, SectionHeading, type AppSection } from './shell/AppShell'
import { AvatarPreviewView } from './views/AvatarPreviewView'
import { RuntimeHealthView } from './views/RuntimeHealthView'

const sectionCopy: Record<AppSection, { title: string; subtitle?: string }> = {
  chat: { title: 'Чат' },
  avatar: { title: 'Avatar Preview', subtitle: 'Предпросмотр модели и её текущего состояния' },
  health: { title: 'Runtime Health', subtitle: 'Состояние подключений и presentation runtime' },
  debug: { title: 'Отладка', subtitle: 'Диагностика и инструменты Runtime' },
  settings: { title: 'Настройки', subtitle: 'Конфигурация приложения и персонажа' }
}

export function App(): React.JSX.Element {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const state = useControllerState()
  const [section, setSection] = useState<AppSection>('chat')
  const [debugOpen, setDebugOpen] = useState(false)
  const isOverlay = useMemo(() => new URLSearchParams(window.location.search).get('overlay') === '1', [])

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

  const copy = sectionCopy[section]

  if (isOverlay) return <Provider colorScheme="dark" locale="ru-RU" UNSAFE_className="app-provider">
    <canvas id="canvas" ref={overlayCanvasRef} />
    {state.overlayAnimationHudEnabled && state.overlayAnimationFile && <div className="overlay-animation-hud">{state.overlayAnimationFile}</div>}
  </Provider>

  return <Provider colorScheme="dark" locale="ru-RU" UNSAFE_className="app-provider">
    <AppShell section={section} onSectionChange={setSection} health={state.health} headerAction={section === 'chat' ? <div className="chat-header-controls"><StreamingModeControl mode={state.continuousListeningMode} listeningState={state.continuousListeningState} onToggle={() => void controller.toggleContinuousListening()} onModeChange={(mode) => void controller.setContinuousListeningMode(mode)} /><OverlayCameraControl overlayState={state.overlayState} cameraMode={state.overlayCameraMode} onToggle={() => controller.toggleOverlay()} onCameraModeChange={(mode) => controller.setOverlayViewMode(mode)} /></div> : undefined}>
      <SectionHeading title={copy.title} subtitle={copy.subtitle} />
    </AppShell>
    <div className="section-content">
      {section === 'chat' && <>
        <ChatOverlay state={state} gateOpen={state.microphoneGate.status !== 'closed'} />
        <MicrophoneGateOverlay
          state={state.microphoneGate}
          onDeviceSelect={(id) => controller.selectMicrophoneGateDevice(id)}
          onRefresh={() => controller.refreshMicrophoneGateDevices()}
          onContinue={() => controller.continueMicrophoneGate()}
          onCancel={() => controller.cancelMicrophoneGate()}
        />
      </>}
      {section === 'avatar' && <AvatarPreviewView onOpenSettings={() => setSection('settings')} />}
      {section === 'health' && <RuntimeHealthView state={state} onRetry={() => { void controller.checkHealth(); void controller.checkLlmHealth() }} />}
      {section === 'debug' && <section className="debug-view"><p>Технические диагностические инструменты открываются отдельно от пользовательского потока.</p><Button variant="secondary" onPress={() => setDebugOpen(true)}>Открыть Debug tools</Button></section>}
      {section === 'settings' && <SettingsDialog isOpen vrmLoaded={state.vrmLoaded} faceTrackingEnabled={state.faceTrackingEnabled} passiveCompanionEnabled={state.passiveCompanionEnabled} onToggleFaceTracking={() => controller.toggleFaceTracking()} onPassiveCompanionChange={(enabled) => controller.setPassiveCompanionMode(enabled)} overlayVisible={state.overlayState === 'on'} overlayViewModeProjection={state.overlayCameraMode} llmHealth={state.llmHealth} onOverlayVisibleChange={() => void controller.refreshOverlayVisibility()} onToggleOverlay={(visible) => controller.setOverlayVisible(visible)} onClose={() => setSection('chat')} />}
    </div>
    <AvatarDebugDialog isOpen={debugOpen} onClose={() => setDebugOpen(false)} />
  </Provider>
}
