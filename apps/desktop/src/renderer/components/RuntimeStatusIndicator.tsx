import { Tooltip, TooltipTrigger } from '@react-spectrum/s2'
import type { HealthState } from '../Controller'

const VARIANT: Record<HealthState, 'positive' | 'notice' | 'negative' | 'neutral'> = {
  ok: 'positive',
  warn: 'notice',
  err: 'negative',
  checking: 'neutral'
}

/** Compact reusable Runtime Health dot. Color + tooltip + accessible label only — no inline text. */
export function RuntimeStatusIndicator({ health, onPress }: {
  health: { state: HealthState; text: string }
  onPress?: () => void
}): React.JSX.Element {
  return <TooltipTrigger delay={200}>
    <button type="button" className="runtime-status-trigger" aria-label={health.text} onClick={onPress}>
      <span className={`runtime-status-light runtime-status-${VARIANT[health.state]}`} aria-hidden="true" />
    </button>
    <Tooltip>{health.text}</Tooltip>
  </TooltipTrigger>
}
