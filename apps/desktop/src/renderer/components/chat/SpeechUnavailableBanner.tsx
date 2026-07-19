import { Button } from '@react-spectrum/s2'
import Close from '@react-spectrum/s2/icons/Close'

import { useTranslation } from '../../localization/useTranslation'
import { bannerCopy, type SpeechCapabilitiesState } from '../../runtime/speechCapabilities'

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
}) {
  const { locale, t } = useTranslation()
  const copy = bannerCopy(capabilities, locale)
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
          {t('speech.banner.retryConnection')}
        </Button>
        <Button variant="secondary" onPress={onOpenHealth}>
          {t('speech.banner.openHealth')}
        </Button>
      </div>
      <button
        type="button"
        className="speech-banner-close"
        aria-label={t('speech.banner.dismiss')}
        onClick={onDismiss}
      >
        <Close />
      </button>
    </div>
  )
}
