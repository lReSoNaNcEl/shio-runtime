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
import Microphone from '@react-spectrum/s2/icons/Microphone'
import Send from '@react-spectrum/s2/icons/Send'
import Stop from '@react-spectrum/s2/icons/StopProcessing'
import { useEffect, useRef, useState } from 'react'

import { type ControllerState, controller } from '../Controller'
import { bannerCopy } from '../runtime/speechCapabilities'
import { SpeechUnavailableBanner } from './SpeechUnavailableBanner'

interface Props {
  state: ControllerState
  /** When the microphone gate is open the chat background is intentionally inert. */
  gateOpen?: boolean
  /** Navigate to the Runtime Health section (from the degradation banner). */
  onOpenHealth?: () => void
}

const TEXT = {
  you: 'Вы',
  assistant: 'Shio',
  synthesizing: 'Генерирую голос...',
  message: 'Сообщение',
  placeholder: 'Напишите Shio…',
  stopRecording: 'Остановить запись',
  voiceInput: 'Голосовой ввод',
  recognitionUnavailable: 'Распознавание речи недоступно',
  send: 'Отправить',
  stopResponse: 'Остановить ответ Shio',
  emptyTitle: 'Shio готова',
}

// Compact quick actions, shown only for an empty conversation. The label is the
// message that gets sent through the existing chat submit flow.
const QUICK_ACTIONS = ['Поздоровайся', 'Расскажи шутку', 'Что ты умеешь?']

type StatusVariant = 'positive' | 'informative' | 'notice' | 'negative'

/**
 * Human-readable composer status derived from the existing Character/Conversation
 * state — no new state machine is introduced.
 */
function deriveChatStatus(state: ControllerState): { variant: StatusVariant; label: string } {
  if (state.continuousListeningState === 'error') {
    return { variant: 'negative', label: 'Ошибка' }
  }
  switch (state.status) {
    case 'listening':
      return { variant: 'informative', label: 'Слушаю' }
    case 'recognizing':
    case 'thinking':
      return { variant: 'notice', label: 'Думаю' }
    case 'synthesizing':
    case 'speaking':
      return { variant: 'informative', label: 'Говорю' }
    default:
      return { variant: 'positive', label: TEXT.emptyTitle }
  }
}

/**
 * Composite voice-availability suffix for the idle status (ТЗ §8). Text chat is
 * fully functional, so the global status stays positive; only a suffix marks that
 * a voice capability is down. A degraded TTS never disables the microphone.
 */
function voiceSuffix(state: ControllerState): string | null {
  const asrDown = state.speechCapabilities.recognition === 'unavailable'
  const ttsDown = state.speechCapabilities.synthesis === 'unavailable'
  if (asrDown && ttsDown) return 'Голос недоступен'
  if (asrDown) return 'Микрофон недоступен'
  if (ttsDown) return 'Озвучивание недоступно'
  return null
}

export function ChatOverlay({ state, gateOpen = false, onOpenHealth }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [interrupting, setInterrupting] = useState(false)
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
    bannerCopy(capabilities) !== null && dismissedIncidentId !== capabilities.incidentId
  const voiceStatusSuffix = voiceSuffix(state)

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
    },
    [],
  )
  const showSpeechProgress = state.status === 'speaking' || state.status === 'synthesizing'
  const isEmpty = state.messages.length === 0
  const chatStatus = deriveChatStatus(state)
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
    const t = raw.trim()
    if (!t) return
    setText('')
    void controller.sendText(t)
  }

  return (
    <section id="chat-panel" ref={panelRef} aria-hidden={gateOpen || undefined}>
      <div id="chat-messages" ref={listRef}>
        {state.continuousListeningState === 'error' && (
          <div className="input-error" role="alert">
            <span>{state.continuousListeningError}</span>
            <Button variant="secondary" onPress={() => void controller.toggleContinuousListening()}>
              Повторить
            </Button>
          </div>
        )}
        {isEmpty && (
          <div className="chat-empty">
            <Chat UNSAFE_className="chat-empty-icon" aria-hidden />
            <Heading level={2}>{TEXT.emptyTitle}</Heading>
            <ButtonGroup>
              {QUICK_ACTIONS.map((action) => (
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
              <span className="msg-name">{m.role === 'user' ? TEXT.you : TEXT.assistant}</span>
            )}
            <span className="msg-text">{m.text}</span>
            {m.interrupted && <span className="msg-interrupted">Остановлено</span>}
          </div>
        ))}
        {state.status === 'synthesizing' && (
          <div className="message message-assistant message-loading">
            <span className="msg-name">{TEXT.assistant}</span>
            <span className="msg-text">{TEXT.synthesizing}</span>
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
            title={voiceStatusSuffix ? 'Текстовый чат работает. Speech API недоступен.' : undefined}
          >
            <StatusLight variant={chatStatus.variant} size="S">
              {voiceStatusSuffix && chatStatus.label === TEXT.emptyTitle
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

        <div id="controls-input">
          <TextField
            aria-label={TEXT.message}
            size="XL"
            value={text}
            onChange={setText}
            placeholder={TEXT.placeholder}
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
                aria-label={TEXT.stopResponse}
                isDisabled={interrupting || state.responseInterruptionPending}
                onPress={() => {
                  setInterrupting(true)
                  void controller.interruptCurrentResponse('manual-stop')
                }}
              >
                {interrupting || state.responseInterruptionPending ? (
                  <ProgressCircle aria-label={TEXT.stopResponse} isIndeterminate size="S" />
                ) : (
                  <Stop />
                )}
              </ActionButton>
              <Tooltip>{TEXT.stopResponse}</Tooltip>
            </TooltipTrigger>
          ) : (
            <TooltipTrigger>
              <ActionButton
                isQuiet
                aria-label={
                  recognitionUnavailable
                    ? TEXT.recognitionUnavailable
                    : listening
                      ? TEXT.stopRecording
                      : TEXT.voiceInput
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
                  ? TEXT.recognitionUnavailable
                  : listening
                    ? TEXT.stopRecording
                    : TEXT.voiceInput}
              </Tooltip>
            </TooltipTrigger>
          )}
          <TooltipTrigger>
            <Button
              variant="accent"
              isDisabled={!text.trim()}
              onPress={() => submit(text)}
              aria-label={TEXT.send}
            >
              <Send />
            </Button>
            <Tooltip>{TEXT.send}</Tooltip>
          </TooltipTrigger>
        </div>
      </div>
    </section>
  )
}
