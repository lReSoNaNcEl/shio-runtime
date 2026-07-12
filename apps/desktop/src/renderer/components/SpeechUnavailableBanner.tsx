import { Button } from '@react-spectrum/s2'
import Close from '@react-spectrum/s2/icons/Close'

import { bannerCopy, type SpeechCapabilitiesState } from '../runtime/speechCapabilities'

/**
 * Compact transient degradation banner shown directly above the composer (ТЗ §3).
 * It is not a full-screen modal and never sits between chat messages. Copy is
 * derived from which capabilities are down; no IP/port/ECONNREFUSED is shown.
 */
export function SpeechUnavailableBanner({
  capabilities,
  highlight,
  onRetry,
  onOpenHealth,
  onDismiss,
}: {
  capabilities: SpeechCapabilitiesState
  highlight: boolean
  onRetry: () => void
  onOpenHealth: () => void
  onDismiss: () => void
}): React.JSX.Element | null {
  const copy = bannerCopy(capabilities)
  if (!copy) return null

  return (
    <div
      className={`speech-banner${highlight ? ' speech-banner-highlight' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="speech-banner-body">
        <span className="speech-banner-title">{copy.title}</span>
        <span className="speech-banner-desc">{copy.description}</span>
      </div>
      <div className="speech-banner-actions">
        <Button variant="secondary" onPress={onRetry}>
          Повторить подключение
        </Button>
        <Button variant="secondary" onPress={onOpenHealth}>
          Открыть Runtime Health
        </Button>
      </div>
      <button
        type="button"
        className="speech-banner-close"
        aria-label="Скрыть уведомление"
        onClick={onDismiss}
      >
        <Close />
      </button>
    </div>
  )
}
