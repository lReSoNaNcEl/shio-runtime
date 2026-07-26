import { Button } from '@react-spectrum/s2'

import { useTranslation } from '../../localization/useTranslation'

export function LlmSetupCard({
  providerName,
  highlight,
  onOpenSettings,
}: {
  providerName: string
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
      <div className="speech-banner-body">
        <span className="speech-banner-title">{t('chat.llmSetup.title')}</span>
        <span className="speech-banner-desc">
          {t('chat.llmSetup.description', { provider: providerName })}
        </span>
      </div>
      <Button variant="accent" onPress={onOpenSettings}>
        {t('chat.llmSetup.openSettings')}
      </Button>
    </div>
  )
}
