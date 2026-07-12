import { useEffect, useRef, useState } from 'react'
import {
  ActionButton,
  Button,
  ButtonGroup,
  Heading,
  ProgressCircle,
  StatusLight,
  TextField,
  Tooltip,
  TooltipTrigger
} from '@react-spectrum/s2'
import Microphone from '@react-spectrum/s2/icons/Microphone'
import Send from '@react-spectrum/s2/icons/Send'
import Chat from '@react-spectrum/s2/icons/Chat'
import Stop from '@react-spectrum/s2/icons/StopProcessing'
import { controller, type ControllerState } from '../Controller'

interface Props {
  state: ControllerState
  /** When the microphone gate is open the chat background is intentionally inert. */
  gateOpen?: boolean
}

const TEXT = {
  you: 'Вы',
  assistant: 'Shio',
  synthesizing: 'Генерирую голос...',
  message: 'Сообщение',
  placeholder: 'Напишите Shio…',
  stopRecording: 'Остановить запись',
  voiceInput: 'Голосовой ввод',
  send: 'Отправить',
  stopResponse: 'Остановить ответ Shio',
  emptyTitle: 'Shio готова'
}

// Compact quick actions, shown only for an empty conversation. The label is the
// message that gets sent through the existing chat submit flow.
const QUICK_ACTIONS = [
  'Поздоровайся',
  'Расскажи шутку',
  'Что ты умеешь?'
]

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
    case 'idle':
    default:
      return { variant: 'positive', label: TEXT.emptyTitle }
  }
}

export function ChatOverlay({ state, gateOpen = false }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [interrupting, setInterrupting] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const busy = state.status !== 'idle'
  const listening = state.status === 'listening'
  const showSpeechProgress = state.status === 'speaking' || state.status === 'synthesizing'
  const isEmpty = state.messages.length === 0
  const chatStatus = deriveChatStatus(state)
  const canInterrupt = ['thinking', 'synthesizing', 'speaking'].includes(state.status) && !state.responseInterruptionPending
  const showResponseControl = canInterrupt || state.responseInterruptionPending

  useEffect(() => {
    if (!state.responseInterruptionPending && !canInterrupt) setInterrupting(false)
  }, [canInterrupt, state.responseInterruptionPending])

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
        {state.continuousListeningState === 'error' && <div className="input-error" role="alert"><span>{state.continuousListeningError}</span><Button variant="secondary" onPress={() => void controller.toggleContinuousListening()}>Повторить</Button></div>}
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
        <div id="controls-status">
          <div className="status-row">
            <StatusLight variant={chatStatus.variant} size="S">{chatStatus.label}</StatusLight>
            {busy && <ProgressCircle aria-label={chatStatus.label} isIndeterminate size="S" UNSAFE_className="status-spinner" />}
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
                {interrupting || state.responseInterruptionPending ? <ProgressCircle aria-label={TEXT.stopResponse} isIndeterminate size="S" /> : <Stop />}
              </ActionButton>
              <Tooltip>{TEXT.stopResponse}</Tooltip>
            </TooltipTrigger>
          ) : (
            <TooltipTrigger>
              <ActionButton
                isQuiet
                aria-label={listening ? TEXT.stopRecording : TEXT.voiceInput}
                isDisabled={state.continuousListeningEnabled || (busy && !listening)}
                onPress={() => void controller.toggleMic()}
                UNSAFE_className={listening ? 'mic-recording' : undefined}
              >
                <Microphone />
              </ActionButton>
              <Tooltip>{listening ? TEXT.stopRecording : TEXT.voiceInput}</Tooltip>
            </TooltipTrigger>
          )}
          <TooltipTrigger>
            <Button variant="accent" isDisabled={!text.trim()} onPress={() => submit(text)} aria-label={TEXT.send}>
              <Send />
            </Button>
            <Tooltip>{TEXT.send}</Tooltip>
          </TooltipTrigger>
        </div>
      </div>
    </section>
  )
}
