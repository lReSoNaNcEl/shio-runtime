import { ActionButton, StatusLight, Tooltip, TooltipTrigger } from '@react-spectrum/s2'

import { type ApplicationHealth } from '../../runtime/runtimeHealth'

const VARIANT: Record<ApplicationHealth, 'positive' | 'notice' | 'negative'> = {
  healthy: 'positive',
  notice: 'notice',
  error: 'negative',
}

/** Application-level Runtime Health trigger; text collapses only at compact widths. */
export function RuntimeStatusIndicator({
  health,
  onPress,
}: {
  health: { state: ApplicationHealth; text: string }
  onPress?: () => void
}) {
  return (
    <TooltipTrigger delay={200}>
      <ActionButton
        isQuiet
        UNSAFE_className="runtime-status-trigger"
        aria-label={health.text}
        onPress={onPress}
      >
        <StatusLight variant={VARIANT[health.state]} size="S">
          <span className="runtime-status-label">{health.text}</span>
        </StatusLight>
      </ActionButton>
      <Tooltip>{health.text}</Tooltip>
    </TooltipTrigger>
  )
}
