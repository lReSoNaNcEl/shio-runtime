import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { type ControllerState, controller } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { bannerCopy } from '../../runtime/speechCapabilities'
import { ChatComposer } from './ChatComposer'
import { ChatMessageList } from './ChatMessageList'
import { ChatStatus } from './ChatStatus'
import { ScreenContextAttachment } from './ScreenContextAttachment'
import { ScreenContextPicker } from './ScreenContextPicker'
import { SpeechUnavailableBanner } from './SpeechUnavailableBanner'
import { useScreenContextAttachment } from './useScreenContextAttachment'

interface Props {
  state: ControllerState
  gateOpen?: boolean
  onOpenHealth?: () => void
  onOpenLlmSettings?: () => void
}

export interface ChatOverlayHandle {
  startNewConversation(): Promise<void>
}

export const ChatOverlay = forwardRef<ChatOverlayHandle, Props>(function ChatOverlay(
  { state, gateOpen = false, onOpenHealth, onOpenLlmSettings },
  ref,
) {
  const { locale, t } = useTranslation()
  const [text, setText] = useState('')
  const [interrupting, setInterrupting] = useState(false)
  const [dismissedIncidentId, setDismissedIncidentId] = useState<number | null>(null)
  const [bannerHighlight, setBannerHighlight] = useState(false)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const screenContext = useScreenContextAttachment()
  const busy = state.status !== 'idle'
  const listening = state.status === 'listening'
  const capabilities = state.speechCapabilities
  const recognitionUnavailable = capabilities.recognition === 'unavailable'
  const bannerVisible =
    bannerCopy(capabilities, locale) !== null && dismissedIncidentId !== capabilities.incidentId
  const canInterrupt =
    ['thinking', 'synthesizing', 'speaking'].includes(state.status) &&
    !state.responseInterruptionPending

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (!state.responseInterruptionPending && !canInterrupt) setInterrupting(false)
  }, [canInterrupt, state.responseInterruptionPending])

  useImperativeHandle(ref, () => ({
    async startNewConversation(): Promise<void> {
      await screenContext.release()
      await controller.startNewConversation()
      setText('')
      setInterrupting(false)
    },
  }))

  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = gateOpen
  }, [gateOpen])

  const pulseBanner = (): void => {
    setDismissedIncidentId(null)
    setBannerHighlight(true)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setBannerHighlight(false), 1200)
  }

  const submit = (raw: string): void => {
    if (gateOpen) return
    const userText = raw.trim()
    if (!userText) return
    void (async () => {
      const captureId = await screenContext.submitCaptureId()
      if (screenContext.pending && !captureId) return
      setText('')
      void controller.sendText(userText, captureId)
    })()
  }

  const quickActions = [t('chat.quick.greet'), t('chat.quick.joke'), t('chat.quick.capabilities')]

  return (
    <section id="chat-panel" ref={panelRef} aria-hidden={gateOpen || undefined}>
      <ChatMessageList
        messages={state.messages}
        status={state.status}
        quickActions={quickActions}
        onQuickAction={submit}
        continuousListeningError={
          state.continuousListeningState === 'error' ? state.continuousListeningError : undefined
        }
        onRetryContinuousListening={() => void controller.toggleContinuousListening()}
      />
      <div id="controls">
        {bannerVisible && (
          <SpeechUnavailableBanner
            capabilities={capabilities}
            highlight={bannerHighlight}
            onRetry={() => controller.recheckSpeechService()}
            onOpenHealth={() => onOpenHealth?.()}
            onDismiss={() => setDismissedIncidentId(capabilities.incidentId)}
          />
        )}
        <ChatStatus state={state} />
        {screenContext.pending && (
          <ScreenContextAttachment
            capture={screenContext.pending}
            submitError={screenContext.submitError}
            onReplace={() => screenContext.setPickerOpen(true)}
            onRemove={() => void screenContext.release()}
          />
        )}
        <ChatComposer
          text={text}
          busy={busy}
          gateOpen={gateOpen}
          listening={listening}
          canInterrupt={canInterrupt}
          interruptionPending={interrupting || state.responseInterruptionPending}
          microphoneUnavailable={recognitionUnavailable}
          microphoneDisabled={state.continuousListeningEnabled || (busy && !listening)}
          onTextChange={setText}
          onSubmit={() => submit(text)}
          onAttachScreen={() => screenContext.setPickerOpen(true)}
          onToggleMicrophone={() => {
            if (recognitionUnavailable) {
              pulseBanner()
              return
            }
            void controller.toggleMic()
          }}
          onInterrupt={() => {
            setInterrupting(true)
            void controller.interruptCurrentResponse('manual-stop')
          }}
        />
      </div>
      <ScreenContextPicker
        isOpen={screenContext.pickerOpen}
        onDismiss={() => screenContext.setPickerOpen(false)}
        onChangeModel={() => {
          screenContext.setPickerOpen(false)
          onOpenLlmSettings?.()
        }}
        onBeforeCapture={screenContext.release}
        onAttach={screenContext.attach}
      />
    </section>
  )
})
