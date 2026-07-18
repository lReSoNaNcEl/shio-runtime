import { ActionButton, StatusLight, Text } from '@react-spectrum/s2'
import Bug from '@react-spectrum/s2/icons/Bug'
import Settings from '@react-spectrum/s2/icons/Settings'

import type { ControllerState } from '../Controller'
import { useTranslation } from '../localization/useTranslation'

const VARIANT: Record<
  ControllerState['health']['state'],
  'positive' | 'notice' | 'negative' | 'neutral'
> = {
  ok: 'positive',
  warn: 'notice',
  err: 'negative',
  checking: 'neutral',
}

interface Props {
  health: ControllerState['health']
  onOpenSettings: () => void
  onOpenDebug: () => void
}

export function TopBar({ health, onOpenSettings, onOpenDebug }: Props): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div id="top-bar">
      <span className="app-title">Shio</span>
      <StatusLight variant={VARIANT[health.state]} size="S">
        {health.text}
      </StatusLight>
      <ActionButton aria-label={t('app.nav.debug')} onPress={onOpenDebug}>
        <Bug />
        <Text>{t('app.nav.debug')}</Text>
      </ActionButton>
      <ActionButton aria-label={t('app.nav.settings')} onPress={onOpenSettings}>
        <Settings />
        <Text>{t('app.nav.settings')}</Text>
      </ActionButton>
    </div>
  )
}
