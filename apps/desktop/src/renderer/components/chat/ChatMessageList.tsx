import {
  Button,
  ButtonGroup,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  Text,
} from '@react-spectrum/s2'
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop'
import DesktopIllustration from '@react-spectrum/s2/illustrations/gradient/generic2/Desktop'
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
  onStartWatch?: () => void
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
  onStartWatch,
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
    if (messages.length === 0) {
      followStreamRef.current = true
      list.scrollTop = 0
      setShowJumpToLatest(false)
      return
    }
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
            {onStartWatch && (
              <section className="chat-share-invitation" aria-labelledby="chat-share-title">
                <div className="chat-share-copy">
                  <Heading id="chat-share-title" level={2}>
                    {t('chat.start.shareTitle')}
                  </Heading>
                  <Text>{t('chat.start.shareDescription')}</Text>
                  <Button
                    variant="accent"
                    onPress={onStartWatch}
                    UNSAFE_className="shio-accent-button"
                  >
                    <DeviceDesktop />
                    <Text>{t('chat.start.chooseSource')}</Text>
                  </Button>
                </div>
                <div className="chat-share-art" aria-hidden="true">
                  <DesktopIllustration />
                </div>
              </section>
            )}
            <div className="chat-quick-action-grid">
              <section className="chat-conversation-starters" aria-labelledby="chat-start-title">
                <Heading level={3} id="chat-start-title">
                  {t('chat.start.conversation')}
                </Heading>
                <fieldset className="chat-starter-action-grid" aria-labelledby="chat-start-title">
                  {quickActions.starter.map((action) => (
                    <Button
                      key={action.id}
                      variant="secondary"
                      onPress={() => onQuickAction(action)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </fieldset>
              </section>
              <div className="chat-start-tools">
                {quickActions.tools.length > 0 && (
                  <Disclosure isQuiet>
                    <DisclosureTitle level={3}>{t('chat.start.tools')}</DisclosureTitle>
                    <DisclosurePanel>
                      <div className="chat-tool-action-grid">
                        {quickActions.tools.map((action) => (
                          <Button
                            key={action.id}
                            size="S"
                            variant="secondary"
                            onPress={() => onQuickAction(action)}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    </DisclosurePanel>
                  </Disclosure>
                )}
                {onOpenCapabilities && (
                  <Button
                    size="S"
                    variant="secondary"
                    fillStyle="outline"
                    onPress={onOpenCapabilities}
                  >
                    {t('chat.quick.catalogAction')}
                  </Button>
                )}
              </div>
            </div>
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
