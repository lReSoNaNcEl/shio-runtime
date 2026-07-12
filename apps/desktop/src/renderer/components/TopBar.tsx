import { ActionButton, StatusLight, Text } from '@react-spectrum/s2'
import Bug from '@react-spectrum/s2/icons/Bug'
import Settings from '@react-spectrum/s2/icons/Settings'
import type { ControllerState } from '../Controller'

const VARIANT: Record<ControllerState['health']['state'], 'positive' | 'notice' | 'negative' | 'neutral'> = {
  ok: 'positive',
  warn: 'notice',
  err: 'negative',
  checking: 'neutral'
}

const LABELS = {
  title: 'Shio',
  avatarDebug: '\u041e\u0442\u043b\u0430\u0434\u043a\u0430 \u0430\u0432\u0430\u0442\u0430\u0440\u0430',
  debug: '\u041e\u0442\u043b\u0430\u0434\u043a\u0430',
  settings: '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438'
}

interface Props {
  health: ControllerState['health']
  onOpenSettings: () => void
  onOpenDebug: () => void
}

export function TopBar({
  health,
  onOpenSettings,
  onOpenDebug
}: Props): React.JSX.Element {
  return (
    <div id="top-bar">
      <span className="app-title">{LABELS.title}</span>
      <StatusLight variant={VARIANT[health.state]} size="S">
        {health.text}
      </StatusLight>
      <ActionButton aria-label={LABELS.avatarDebug} onPress={onOpenDebug}>
        <Bug />
        <Text>{LABELS.debug}</Text>
      </ActionButton>
      <ActionButton aria-label={LABELS.settings} onPress={onOpenSettings}>
        <Settings />
        <Text>{LABELS.settings}</Text>
      </ActionButton>
    </div>
  )
}
