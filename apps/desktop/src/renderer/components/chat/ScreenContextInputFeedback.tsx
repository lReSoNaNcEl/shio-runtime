import { Button, ButtonGroup } from '@react-spectrum/s2'

import { type ConversationTurnFailure } from '../../../shared/conversation'
import { useTranslation } from '../../localization/useTranslation'
import { screenContextErrorMessage } from './screenContextErrorMessage'

export type ChatTurnFailure = ConversationTurnFailure & {
  providerName: string
}

export function ScreenContextInputFeedback({
  error,
  failure,
  onRetry,
  onSendWithoutImage,
}: {
  error: string | null
  failure?: ChatTurnFailure | null
  onRetry?: () => void
  onSendWithoutImage?: () => void
}) {
  const { t } = useTranslation()
  if (!error && !failure) return null
  const failureMessage = failure
    ? failure.domain === 'screen-context'
      ? screenContextErrorMessage(failure.code, t)
      : t(`chat.turnFailure.${failure.code}`, { provider: failure.providerName })
    : null
  return (
    <div className="screen-context-input-feedback" role="alert">
      <span>{error ?? failureMessage}</span>
      {(onRetry || onSendWithoutImage) && (
        <ButtonGroup size="S">
          {onRetry && (
            <Button variant="secondary" onPress={onRetry}>
              {t('chat.turnFailure.retry')}
            </Button>
          )}
          {onSendWithoutImage && (
            <Button variant="secondary" onPress={onSendWithoutImage}>
              {t('chat.turnFailure.sendWithoutImage')}
            </Button>
          )}
        </ButtonGroup>
      )}
    </div>
  )
}
