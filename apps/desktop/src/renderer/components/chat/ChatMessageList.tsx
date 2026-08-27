import { Button, ButtonGroup, Heading } from '@react-spectrum/s2'
import Chat from '@react-spectrum/s2/icons/Chat'
import { useEffect, useRef } from 'react'

import { type ControllerState } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { MarkdownMessage } from './MarkdownMessage'
import { ProjectEvidenceBar } from './ProjectEvidenceBar'

export interface ChatMessageListProps {
  messages: ControllerState['messages']
  status: ControllerState['status']
  quickActions: readonly string[]
  onQuickAction: (text: string) => void
  continuousListening: ControllerState['continuousListening']
  onRetryContinuousListening?: () => void
  onDisableContinuousListening?: () => void
}

export function ChatMessageList({
  messages,
  status,
  quickActions,
  onQuickAction,
  continuousListening,
  onRetryContinuousListening,
  onDisableContinuousListening,
}: ChatMessageListProps) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages is the intentional trigger for scrolling to the newest message.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  return (
    <div id="chat-messages" ref={listRef}>
      {continuousListening.desired && continuousListening.transport === 'failed' && (
        <div className="input-error" role="alert">
          <span>
            {t(
              continuousListening.failure?.domain === 'microphone' ||
                continuousListening.failure?.domain === 'permission'
                ? 'streaming.failure.microphone'
                : 'streaming.failure.connection',
            )}
          </span>
          <ButtonGroup>
            <Button variant="secondary" onPress={() => onRetryContinuousListening?.()}>
              {t('common.retry')}
            </Button>
            <Button variant="secondary" onPress={() => onDisableContinuousListening?.()}>
              {t('streaming.action.off')}
            </Button>
          </ButtonGroup>
        </div>
      )}
      {messages.length === 0 && (
        <div className="chat-empty">
          <Chat UNSAFE_className="chat-empty-icon" aria-hidden />
          <Heading level={2}>{t('chat.ready')}</Heading>
          <ButtonGroup>
            {quickActions.map((action) => (
              <Button key={action} variant="secondary" onPress={() => onQuickAction(action)}>
                {action}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      )}
      {messages.map((message) => (
        <div key={message.id} className={`message message-${message.role}`}>
          {message.role !== 'error' && message.role !== 'meta' && (
            <span className="msg-name">
              {message.role === 'user' ? t('chat.you') : t('chat.assistant')}
            </span>
          )}
          {message.role === 'assistant' ? (
            <div className="msg-text">
              <MarkdownMessage text={message.text} />
            </div>
          ) : (
            <span className="msg-text">{message.text}</span>
          )}
          {message.role === 'assistant' && message.grounding?.project && (
            <ProjectEvidenceBar provenance={message.grounding.project} />
          )}
          {message.interrupted && <span className="msg-interrupted">{t('chat.interrupted')}</span>}
        </div>
      ))}
      {status === 'synthesizing' && (
        <div className="message message-assistant message-loading">
          <span className="msg-name">{t('chat.assistant')}</span>
          <span className="msg-text">{t('chat.synthesizing')}</span>
        </div>
      )}
    </div>
  )
}
