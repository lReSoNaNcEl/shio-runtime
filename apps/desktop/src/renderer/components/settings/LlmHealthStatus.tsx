import { ProgressCircle, StatusLight } from '@react-spectrum/s2'
import type * as React from 'react'

import type { ControllerState } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'

export function LlmHealthStatus({
  health,
}: {
  health: ControllerState['llmHealth']
}): React.JSX.Element {
  const { t } = useTranslation()
  const status =
    health.state === 'ok'
      ? { variant: 'positive' as const, label: t('common.available') }
      : health.state === 'checking'
        ? { variant: 'informative' as const, label: t('common.checking') }
        : health.state === 'error'
          ? { variant: 'negative' as const, label: t('common.error') }
          : { variant: 'neutral' as const, label: t('common.notConfigured') }

  return (
    <div className="llm-health-status" title={health.detail}>
      <StatusLight role="status" variant={status.variant} size="S">
        {status.label}
      </StatusLight>
      {health.state === 'checking' && (
        <ProgressCircle aria-label={t('settings.llm.healthChecking')} isIndeterminate size="S" />
      )}
    </div>
  )
}
