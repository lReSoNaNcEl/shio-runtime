import { ActionButton, StatusLight, Tooltip, TooltipTrigger } from '@react-spectrum/s2'

import { type HealthState } from '../../Controller'

const VARIANT: Record<HealthState, 'positive' | 'notice' | 'negative' | 'neutral'> = {
  ok: 'positive',
  warn: 'notice',
  err: 'negative',
  checking: 'neutral',
}

/** Compact reusable Runtime Health dot. Color + tooltip + accessible label only — no inline text. */
export function RuntimeStatusIndicator({
  health,
  onPress,
}: {
  health: { state: HealthState; text: string }
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
          <span className="visually-hidden">{health.text}</span>
        </StatusLight>
      </ActionButton>
      <Tooltip>{health.text}</Tooltip>
    </TooltipTrigger>
  )
}
