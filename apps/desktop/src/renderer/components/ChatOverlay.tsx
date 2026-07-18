import {
  ActionButton,
  Button,
  ButtonGroup,
  Heading,
  ProgressCircle,
  StatusLight,
  TextField,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import Chat from '@react-spectrum/s2/icons/Chat'
import ImageAdd from '@react-spectrum/s2/icons/ImageAdd'
import Microphone from '@react-spectrum/s2/icons/Microphone'
import Send from '@react-spectrum/s2/icons/Send'
import Stop from '@react-spectrum/s2/icons/StopProcessing'
import { useEffect, useRef, useState } from 'react'

import type { ScreenContextCaptureDescriptor } from '../../shared/screenContext'
import { type ControllerState, controller } from '../Controller'
import type { LocalizationContextValue } from '../localization/LocalizationProvider'
import { useTranslation } from '../localization/useTranslation'
import { bannerCopy } from '../runtime/speechCapabilities'
import { ScreenContextPicker } from './ScreenContextPicker'
import { SpeechUnavailableBanner } from './SpeechUnavailableBanner'

interface Props {
  state: ControllerState
  /** When the microphone gate is open the chat background is intentionally inert. */
  gateOpen?: boolean
  /** Navigate to the Runtime Health section (from the degradation banner). */
  onOpenHealth?: () => void
}

type StatusVariant = 'positive' | 'informative' | 'notice' | 'negative'

/**
 * Human-readable composer status derived from the existing Character/Conversation
 * state — no new state machine is introduced.
 */
function deriveChatStatus(
  state: ControllerState,
  t: LocalizationContextValue['t'],
): { variant: StatusVariant; label: string } {
  if (state.continuousListeningState === 'error') {
    return { variant: 'negative', label: t('chat.status.error') }
  }
  switch (state.status) {
    case 'listening':
      return { variant: 'informative', label: t('chat.status.listening') }
    case 'recognizing':
    case 'thinking':
      return { variant: 'notice', label: t('chat.status.thinking') }
    case 'synthesizing':
    case 'speaking':
      return { variant: 'informative', label: t('chat.status.speaking') }
    default:
      return { variant: 'positive', label: t('chat.ready') }
  }
}

/**
 * Composite voice-availability suffix for the idle status (ТЗ §8). Text chat is
 * fully functional, so the global status stays positive; only a suffix marks that
 * a voice capability is down. A degraded TTS never disables the microphone.
 */
function voiceSuffix(state: ControllerState, t: LocalizationContextValue['t']): string | null {
  const asrDown = state.speechCapabilities.recognition === 'unavailable'
  const ttsDown = state.speechCapabilities.synthesis === 'unavailable'
  if (asrDown && ttsDown) return t('chat.voice.none')
  if (asrDown) return t('chat.voice.microphone')
  if (ttsDown) return t('chat.voice.synthesis')
  return null
}

export function ChatOverlay({ state, gateOpen = false, onOpenHealth }: Props): React.JSX.Element {
  const { locale, t } = useTranslation()
  const quickActions = [t('chat.quick.greet'), t('chat.quick.joke'), t('chat.quick.capabilities')]
  const [text, setText] = useState('')
  const [interrupting, setInterrupting] = useState(false)
  const [screenPickerOpen, setScreenPickerOpen] = useState(false)
  const [pendingScreenContext, setPendingScreenContext] =
    useState<ScreenContextCaptureDescriptor | null>(null)
  const [screenContextSubmitError, setScreenContextSubmitError] = useState<string | null>(null)
  const pendingScreenContextRef = useRef<ScreenContextCaptureDescriptor | null>(null)
  // Presentation-only state: the banner dismissal is per incident, and a click on
  // the unavailable microphone pulses the banner. Neither belongs to the runtime.
  const [dismissedIncidentId, setDismissedIncidentId] = useState<number | null>(null)
  const [bannerHighlight, setBannerHighlight] = useState(false)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const busy = state.status !== 'idle'
  const listening = state.status === 'listening'
  const capabilities = state.speechCapabilities
  const recognitionUnavailable = capabilities.recognition === 'unavailable'
  const bannerVisible =
    bannerCopy(capabilities, locale) !== null && dismissedIncidentId !== capabilities.incidentId
  const voiceStatusSuffix = voiceSuffix(state, t)

  const pulseBanner = (): void => {
    // Ensure the banner is visible again if it was dismissed, then flash it.
    setDismissedIncidentId(null)
    setBannerHighlight(true)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setBannerHighlight(false), 1200)
  }

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      const pending = pendingScreenContextRef.current
      if (pending) void window.api.screenContext.release(pending.captureId)
    },
    [],
  )
  const showSpeechProgress = state.status === 'speaking' || state.status === 'synthesizing'
  const isEmpty = state.messages.length === 0
  const chatStatus = deriveChatStatus(state, t)
  const canInterrupt =
    ['thinking', 'synthesizing', 'speaking'].includes(state.status) &&
    !state.responseInterruptionPending
  const showResponseControl = canInterrupt || state.responseInterruptionPending

  useEffect(() => {
    if (!state.responseInterruptionPending && !canInterrupt) setInterrupting(false)
  }, [canInterrupt, state.responseInterruptionPending])

  // biome-ignore lint/correctness/useExhaustiveDependencies: state.messages is an intentional trigger — the body reads only the ref but must re-run to scroll to the newest message when the list changes.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [state.messages])

  // Make the chat background truly non-interactive (keyboard included) while the
  // microphone gate is open. The gate backdrop already blocks pointer input.
  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = gateOpen
  }, [gateOpen])

  // Single submit path, reused by the composer and the quick actions.
  const submit = (raw: string): void => {
    if (gateOpen) return
    const userText = raw.trim()
    if (!userText) return
    void (async () => {
      const captureId = pendingScreenContext?.captureId
      if (captureId) {
        try {
          const capabilities = await window.api.llm.getActiveCapabilities()
          if (!capabilities.supportsVision) {
            setScreenContextSubmitError(t('screenContext.error.visionUnsupported'))
            return
          }
        } catch {
          setScreenContextSubmitError(t('screenContext.error.unknown'))
          return
        }
        if (pendingScreenContextRef.current?.captureId !== captureId) return
      }
      setScreenContextSubmitError(null)
      setText('')
      pendingScreenContextRef.current = null
      setPendingScreenContext(null)
      void controller.sendText(userText, captureId)
    })()
  }

  const releasePendingScreenContext = async (): Promise<void> => {
    const pending = pendingScreenContextRef.current
    pendingScreenContextRef.current = null
    setPendingScreenContext(null)
    setScreenContextSubmitError(null)
    if (pending) await window.api.screenContext.release(pending.captureId)
  }

  const attachScreenContext = (capture: ScreenContextCaptureDescriptor): void => {
    pendingScreenContextRef.current = capture
    setPendingScreenContext(capture)
    setScreenContextSubmitError(null)
  }

  return (
    <section id="chat-panel" ref={panelRef} aria-hidden={gateOpen || undefined}>
      <div id="chat-messages" ref={listRef}>
        {state.continuousListeningState === 'error' && (
          <div className="input-error" role="alert">
            <span>{state.continuousListeningError}</span>
            <Button variant="secondary" onPress={() => void controller.toggleContinuousListening()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
        {isEmpty && (
          <div className="chat-empty">
            <Chat UNSAFE_className="chat-empty-icon" aria-hidden />
            <Heading level={2}>{t('chat.ready')}</Heading>
            <ButtonGroup>
              {quickActions.map((action) => (
                <Button key={action} variant="secondary" onPress={() => submit(action)}>
                  {action}
                </Button>
              ))}
            </ButtonGroup>
          </div>
        )}
        {state.messages.map((m) => (
          <div key={m.id} className={`message message-${m.role}`}>
            {m.role !== 'error' && m.role !== 'meta' && (
              <span className="msg-name">
                {m.role === 'user' ? t('chat.you') : t('chat.assistant')}
              </span>
            )}
            <span className="msg-text">{m.text}</span>
            {m.interrupted && <span className="msg-interrupted">{t('chat.interrupted')}</span>}
          </div>
        ))}
        {state.status === 'synthesizing' && (
          <div className="message message-assistant message-loading">
            <span className="msg-name">{t('chat.assistant')}</span>
            <span className="msg-text">{t('chat.synthesizing')}</span>
          </div>
        )}
      </div>

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
        <div id="controls-status">
          <div
            className="status-row"
            title={voiceStatusSuffix ? t('chat.voiceUnavailableTitle') : undefined}
          >
            <StatusLight variant={chatStatus.variant} size="S">
              {voiceStatusSuffix && chatStatus.label === t('chat.ready')
                ? `${chatStatus.label} · ${voiceStatusSuffix}`
                : chatStatus.label}
            </StatusLight>
            {busy && (
              <ProgressCircle
                aria-label={chatStatus.label}
                isIndeterminate
                size="S"
                UNSAFE_className="status-spinner"
              />
            )}
          </div>
          <div className={showSpeechProgress ? 'speech-progress visible' : 'speech-progress'}>
            <span style={{ width: `${Math.round(state.speechProgress * 100)}%` }} />
          </div>
        </div>

        {pendingScreenContext && (
          <div className="screen-context-attachment">
            <img src={pendingScreenContext.previewDataUrl} alt="" />
            <div className="screen-context-attachment-copy">
              <strong title={pendingScreenContext.sourceName}>
                {pendingScreenContext.sourceName}
              </strong>
              <span>
                {pendingScreenContext.width} × {pendingScreenContext.height}
              </span>
              <small>{t('screenContext.privacy')}</small>
            </div>
            <ButtonGroup size="S">
              <Button variant="secondary" onPress={() => setScreenPickerOpen(true)}>
                {t('screenContext.replace')}
              </Button>
              <Button variant="secondary" onPress={() => void releasePendingScreenContext()}>
                {t('screenContext.remove')}
              </Button>
            </ButtonGroup>
            {screenContextSubmitError && (
              <span className="screen-context-attachment-error" role="alert">
                {screenContextSubmitError}
              </span>
            )}
          </div>
        )}
        <div id="controls-input">
          <TooltipTrigger>
            <ActionButton
              isQuiet
              aria-label={t('screenContext.attach.action')}
              isDisabled={gateOpen || busy}
              onPress={() => setScreenPickerOpen(true)}
            >
              <ImageAdd />
            </ActionButton>
            <Tooltip>{t('screenContext.attach.action')}</Tooltip>
          </TooltipTrigger>
          <TextField
            aria-label={t('chat.message')}
            size="XL"
            value={text}
            onChange={setText}
            placeholder={t('chat.placeholder')}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is left to the field's default handling.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit(text)
              }
            }}
            UNSAFE_className="chat-input"
          />
          {showResponseControl ? (
            <TooltipTrigger>
              <ActionButton
                isQuiet
                aria-label={t('chat.stopResponse')}
                isDisabled={interrupting || state.responseInterruptionPending}
                onPress={() => {
                  setInterrupting(true)
                  void controller.interruptCurrentResponse('manual-stop')
                }}
              >
                {interrupting || state.responseInterruptionPending ? (
                  <ProgressCircle aria-label={t('chat.stopResponse')} isIndeterminate size="S" />
                ) : (
                  <Stop />
                )}
              </ActionButton>
              <Tooltip>{t('chat.stopResponse')}</Tooltip>
            </TooltipTrigger>
          ) : (
            <TooltipTrigger>
              <ActionButton
                isQuiet
                aria-label={
                  recognitionUnavailable
                    ? t('chat.recognitionUnavailable')
                    : listening
                      ? t('chat.stopRecording')
                      : t('chat.voiceInput')
                }
                // The button stays visible when recognition is unavailable, but is
                // not disabled: a press must not silently fail — it pulses the
                // banner (ТЗ §4) instead of starting a recording/ASR request.
                isDisabled={
                  !recognitionUnavailable &&
                  (state.continuousListeningEnabled || (busy && !listening))
                }
                onPress={() => {
                  if (recognitionUnavailable) {
                    pulseBanner()
                    return
                  }
                  void controller.toggleMic()
                }}
                UNSAFE_className={
                  recognitionUnavailable
                    ? 'mic-unavailable'
                    : listening
                      ? 'mic-recording'
                      : undefined
                }
              >
                <Microphone />
              </ActionButton>
              <Tooltip>
                {recognitionUnavailable
                  ? t('chat.recognitionUnavailable')
                  : listening
                    ? t('chat.stopRecording')
                    : t('chat.voiceInput')}
              </Tooltip>
            </TooltipTrigger>
          )}
          <TooltipTrigger>
            <Button
              variant="accent"
              isDisabled={!text.trim()}
              onPress={() => submit(text)}
              aria-label={t('chat.send')}
            >
              <Send />
            </Button>
            <Tooltip>{t('chat.send')}</Tooltip>
          </TooltipTrigger>
        </div>
      </div>
      <ScreenContextPicker
        isOpen={screenPickerOpen}
        onDismiss={() => setScreenPickerOpen(false)}
        onBeforeCapture={releasePendingScreenContext}
        onAttach={attachScreenContext}
      />
    </section>
  )
}
