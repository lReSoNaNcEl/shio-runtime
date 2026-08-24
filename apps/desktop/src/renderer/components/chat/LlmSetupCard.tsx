import { Button } from '@react-spectrum/s2'

import { type LlmReadinessReason } from '../../../shared/llm'
import { useTranslation } from '../../localization/useTranslation'

export function LlmSetupCard({
  providerName,
  reason,
  highlight,
  onOpenSettings,
}: {
  providerName: string
  reason: Extract<LlmReadinessReason, 'missing-account-id' | 'missing-credential' | 'model-missing'>
  highlight: boolean
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className={`llm-setup-card${highlight ? ' llm-setup-card-highlight' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="llm-setup-card-body">
        <span className="llm-setup-card-title">{t('chat.llmSetup.title')}</span>
        <span className="llm-setup-card-description">
          {reason === 'model-missing'
            ? t('chat.llmSetup.modelMissingDescription', { provider: providerName })
            : reason === 'missing-account-id'
              ? t('chat.llmSetup.accountIdMissingDescription', { provider: providerName })
              : t('chat.llmSetup.description', { provider: providerName })}
        </span>
      </div>
      <Button variant="accent" onPress={onOpenSettings} UNSAFE_className="shio-accent-button">
        {t('chat.llmSetup.openSettings')}
      </Button>
    </div>
  )
}
