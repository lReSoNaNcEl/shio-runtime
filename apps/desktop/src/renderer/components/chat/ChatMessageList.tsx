import { Button, ButtonGroup, Heading } from '@react-spectrum/s2'
import Chat from '@react-spectrum/s2/icons/Chat'
import { useEffect, useRef, useState } from 'react'

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
  const followStreamRef = useRef(true)
  const previousLastMessageIdRef = useRef<string | undefined>(undefined)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const lastMessage = messages.at(-1)
    const isNewUserMessage =
      lastMessage?.role === 'user' && previousLastMessageIdRef.current !== lastMessage.id
    previousLastMessageIdRef.current = lastMessage?.id
    if (isNewUserMessage) followStreamRef.current = true
    if (followStreamRef.current) {
      list.scrollTop = list.scrollHeight
      setShowJumpToLatest(false)
    } else if (lastMessage?.role === 'assistant') {
      setShowJumpToLatest(true)
    }
  }, [messages])

  const updateFollowState = (): void => {
    const list = listRef.current
    if (!list) return
    followStreamRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= 100
    if (followStreamRef.current) setShowJumpToLatest(false)
  }

  const jumpToLatest = (): void => {
    const list = listRef.current
    if (!list) return
    followStreamRef.current = true
    list.scrollTop = list.scrollHeight
    setShowJumpToLatest(false)
  }

  return (
    <div className="chat-message-list">
      <div id="chat-messages" ref={listRef} onScroll={updateFollowState}>
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
          <div
            key={message.id}
            className={`message message-${message.role}`}
            aria-busy={message.streaming || undefined}
          >
            {message.role !== 'error' && message.role !== 'meta' && (
              <span className="msg-name">
                {message.role === 'user' ? t('chat.you') : t('chat.assistant')}
              </span>
            )}
            {message.role === 'assistant' ? (
              <div className="msg-text">
                <MarkdownMessage text={message.text} streaming={message.streaming} />
              </div>
            ) : (
              <span className="msg-text">{message.text}</span>
            )}
            {message.role === 'assistant' && message.grounding?.project && (
              <ProjectEvidenceBar provenance={message.grounding.project} />
            )}
            {message.interrupted && (
              <span className="msg-interrupted">{t('chat.interrupted')}</span>
            )}
          </div>
        ))}
        {status === 'synthesizing' && (
          <div className="message message-assistant message-loading">
            <span className="msg-name">{t('chat.assistant')}</span>
            <span className="msg-text">{t('chat.synthesizing')}</span>
          </div>
        )}
      </div>
      {showJumpToLatest && (
        <div className="chat-jump-to-latest">
          <Button variant="secondary" onPress={jumpToLatest}>
            {t('chat.jumpToLatest')}
          </Button>
        </div>
      )}
    </div>
  )
}
