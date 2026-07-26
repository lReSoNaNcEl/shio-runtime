import {
  type ClipboardEvent,
  type DragEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

import { type ControllerState, controller } from '../../Controller'
import { shouldBlockChatSubmission } from '../../controller/firstRunState'
import { useTranslation } from '../../localization/useTranslation'
import { bannerCopy } from '../../runtime/speechCapabilities'
import { ChatComposer } from './ChatComposer'
import { ChatMessageList } from './ChatMessageList'
import { ChatStatus } from './ChatStatus'
import { LlmSetupCard } from './LlmSetupCard'
import { ScreenContextAttachment } from './ScreenContextAttachment'
import { ScreenContextDropOverlay } from './ScreenContextDropOverlay'
import { ScreenContextInputFeedback } from './ScreenContextInputFeedback'
import { ScreenContextPicker } from './ScreenContextPicker'
import { SpeechUnavailableBanner } from './SpeechUnavailableBanner'
import {
  clipboardImageFiles,
  droppedImageFiles,
  isSupportedImageMimeType,
} from './screenContextImageInput'
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
  const text = state.chatDraft
  const [interrupting, setInterrupting] = useState(false)
  const [dismissedIncidentId, setDismissedIncidentId] = useState<number | null>(null)
  const [bannerHighlight, setBannerHighlight] = useState(false)
  const [llmSetupHighlight, setLlmSetupHighlight] = useState(false)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const llmHighlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragDepthRef = useRef(0)
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
  const imageOperationActive = screenContext.importing || screenContext.recapturing
  const imageInputAvailable =
    !gateOpen && !busy && !imageOperationActive && !screenContext.pickerOpen

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      if (llmHighlightTimer.current) clearTimeout(llmHighlightTimer.current)
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
      controller.setChatDraft('')
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
    if (gateOpen || imageOperationActive) return
    const userText = raw.trim()
    if (!userText) return
    if (shouldBlockChatSubmission(state.llmReadiness)) {
      setLlmSetupHighlight(true)
      if (llmHighlightTimer.current) clearTimeout(llmHighlightTimer.current)
      llmHighlightTimer.current = setTimeout(() => setLlmSetupHighlight(false), 1200)
      return
    }
    void (async () => {
      const captureId = await screenContext.submitCaptureId()
      if (screenContext.pending && !captureId) return
      controller.setChatDraft('')
      void controller.sendText(userText, captureId)
    })()
  }

  const quickActions = [t('chat.quick.greet'), t('chat.quick.joke'), t('chat.quick.capabilities')]

  const handlePaste = (event: ClipboardEvent<HTMLElement>): void => {
    if (!imageInputAvailable) return
    const imageItems = Array.from(event.clipboardData.items).filter(
      (item) => item.kind === 'file' && item.type.startsWith('image/'),
    )
    if (imageItems.length === 0) return
    event.preventDefault()
    const files = clipboardImageFiles(event.clipboardData)
    if (files.length > 1) {
      screenContext.setInputError(t('screenContext.input.onlyOneImage'))
      return
    }
    if (files.length !== 1 || imageItems.some((item) => !isSupportedImageMimeType(item.type))) {
      screenContext.setInputError(t('screenContext.input.unsupportedType'))
      return
    }
    void screenContext.importFile(files[0], 'clipboard')
  }

  const isFileDrag = (event: DragEvent<HTMLElement>): boolean =>
    event.dataTransfer.types.includes('Files')

  const handleDragEnter = (event: DragEvent<HTMLElement>): void => {
    if (!imageInputAvailable || !isFileDrag(event)) return
    event.preventDefault()
    dragDepthRef.current += 1
    screenContext.setDragActive(true)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!imageInputAvailable || !isFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>): void => {
    if (!isFileDrag(event)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) screenContext.setDragActive(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    dragDepthRef.current = 0
    screenContext.setDragActive(false)
    if (!imageInputAvailable || !isFileDrag(event)) return
    event.preventDefault()
    const allFiles = Array.from(event.dataTransfer.files)
    if (allFiles.length > 1) {
      screenContext.setInputError(t('screenContext.input.onlyOneImage'))
      return
    }
    const files = droppedImageFiles(event.dataTransfer)
    if (allFiles.length !== 1 || files.length !== 1) {
      screenContext.setInputError(t('screenContext.input.unsupportedType'))
      return
    }
    void screenContext.importFile(files[0], 'file')
  }

  return (
    <section
      id="chat-panel"
      ref={panelRef}
      aria-hidden={gateOpen || undefined}
      onPaste={handlePaste}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {screenContext.dragActive && imageInputAvailable && <ScreenContextDropOverlay />}
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
        {state.llmReadiness.reason === 'missing-credential' && (
          <LlmSetupCard
            providerName={state.llmReadiness.providerDisplayName}
            highlight={llmSetupHighlight}
            onOpenSettings={() => onOpenLlmSettings?.()}
          />
        )}
        <ChatStatus state={state} />
        <ScreenContextInputFeedback error={screenContext.error} />
        {screenContext.pending && (
          <ScreenContextAttachment
            capture={screenContext.pending}
            recapturing={screenContext.recapturing}
            imageOperationActive={imageOperationActive}
            onRecapture={() => void screenContext.recapture()}
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
          onTextChange={(draft) => controller.setChatDraft(draft)}
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
        onAttach={screenContext.attach}
      />
    </section>
  )
})
