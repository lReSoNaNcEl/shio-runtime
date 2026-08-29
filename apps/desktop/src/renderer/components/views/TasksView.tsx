import { ProgressCircle } from '@react-spectrum/s2'

import { type AliveSnapshot } from '../../../shared/alive'
import { useTranslation } from '../../localization/useTranslation'
import { BetweenUsOverview } from './between-us/BetweenUsOverview'

export function TasksView({
  snapshot,
  onOpenAutonomySettings,
  onOpenChat,
}: {
  snapshot: AliveSnapshot | null
  onOpenAutonomySettings: () => void
  onOpenChat: () => void
}) {
  const { t } = useTranslation()

  if (!snapshot) {
    return (
      <div className="tasks-loading page-container">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
      </div>
    )
  }

  return (
    <BetweenUsOverview
      snapshot={snapshot}
      onOpenAutonomySettings={onOpenAutonomySettings}
      onOpenChat={onOpenChat}
    />
  )
}
