import { Button, ButtonGroup } from '@react-spectrum/s2'

import { type LlmTurnErrorCode } from '../../../shared/llm'
import { useTranslation } from '../../localization/useTranslation'

export interface ChatTurnFailure {
  code: LlmTurnErrorCode
  recoverable: boolean
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
    ? t(`chat.turnFailure.${failure.code}`, { provider: failure.providerName })
    : null
  return (
    <div className="screen-context-input-feedback" role="alert">
      <span>{error ?? failureMessage}</span>
      {failure?.recoverable && onRetry && (
        <ButtonGroup size="S">
          <Button variant="secondary" onPress={onRetry}>
            {t('chat.turnFailure.retry')}
          </Button>
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
