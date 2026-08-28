import { Badge, Button, ButtonGroup, Heading, StatusLight, Text } from '@react-spectrum/s2'
import Chat from '@react-spectrum/s2/icons/Chat'
import MagicWand from '@react-spectrum/s2/icons/MagicWand'
import RocketQuickActions from '@react-spectrum/s2/icons/RocketQuickActions'
import { useEffect, useRef, useState } from 'react'

import { type ControllerState } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { type ChatQuickAction, type ChatQuickActionGroups } from './chatQuickActions'
import { MarkdownMessage } from './MarkdownMessage'
import { ProjectEvidenceBar } from './ProjectEvidenceBar'

export interface ChatMessageListProps {
  messages: ControllerState['messages']
  status: ControllerState['status']
  quickActions: ChatQuickActionGroups
  onQuickAction: (action: ChatQuickAction) => void
  onOpenCapabilities?: () => void
  continuousListening: ControllerState['continuousListening']
  onRetryContinuousListening?: () => void
  onDisableContinuousListening?: () => void
}

export function ChatMessageList({
  messages,
  status,
  quickActions,
  onQuickAction,
  onOpenCapabilities,
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
            <div className="chat-empty-hero">
              <div className="chat-empty-icon-frame" aria-hidden="true">
                <Chat UNSAFE_className="chat-empty-icon" />
              </div>
              <StatusLight variant="positive" size="S">
                {t('chat.ready')}
              </StatusLight>
              <Heading level={2}>{t('chat.empty.title')}</Heading>
              <Text UNSAFE_className="chat-empty-description">{t('chat.empty.description')}</Text>
            </div>

            <div className="chat-quick-action-grid">
              <section
                className="chat-quick-action-group chat-quick-action-group-starter"
                aria-labelledby="chat-quick-start-title"
              >
                <div className="chat-quick-action-heading">
                  <MagicWand aria-hidden />
                  <Heading id="chat-quick-start-title" level={3}>
                    {t('chat.quick.startTitle')}
                  </Heading>
                </div>
                <Text UNSAFE_className="chat-quick-action-description">
                  {t('chat.quick.startDescription')}
                </Text>
                <fieldset
                  className="chat-quick-action-buttons chat-starter-action-grid"
                  aria-labelledby="chat-quick-start-title"
                >
                  {quickActions.starter.map((action, index) => (
                    <Button
                      key={action.id}
                      size="M"
                      variant={index === 0 ? 'accent' : 'secondary'}
                      UNSAFE_className={`chat-starter-action${index === 0 ? ' shio-accent-button' : ''}`}
                      onPress={() => onQuickAction(action)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </fieldset>
              </section>

              {quickActions.tools.length > 0 && (
                <section
                  className="chat-quick-action-group chat-quick-action-group-tools"
                  aria-labelledby="chat-quick-tools-title"
                >
                  <div className="chat-quick-action-heading">
                    <RocketQuickActions aria-hidden />
                    <Heading id="chat-quick-tools-title" level={3}>
                      {t('chat.quick.toolsTitle')}
                    </Heading>
                    <Badge size="S" variant="gray" UNSAFE_className="chat-quick-action-count">
                      {quickActions.tools.length}
                    </Badge>
                  </div>
                  <Text UNSAFE_className="chat-quick-action-description">
                    {t('chat.quick.toolsDescription')}
                  </Text>
                  <fieldset
                    className="chat-quick-action-buttons chat-tool-action-grid"
                    aria-labelledby="chat-quick-tools-title"
                  >
                    {quickActions.tools.map((action) => (
                      <Button
                        key={action.id}
                        size="S"
                        variant="secondary"
                        UNSAFE_className="chat-tool-action"
                        onPress={() => onQuickAction(action)}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </fieldset>
                </section>
              )}
            </div>

            {onOpenCapabilities && (
              <div className="chat-empty-catalog-link">
                <Text>{t('chat.quick.catalogHint')}</Text>
                <Button size="S" variant="secondary" onPress={onOpenCapabilities}>
                  {t('chat.quick.catalogAction')}
                </Button>
              </div>
            )}
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
