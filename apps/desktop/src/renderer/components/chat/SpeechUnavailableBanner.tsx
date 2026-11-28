import { ActionButton, Button, Text } from '@react-spectrum/s2'
import Close from '@react-spectrum/s2/icons/Close'
import { useState } from 'react'

import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
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
  onOpenSpeechSettings,
  onDismiss,
}: {
  capabilities: SpeechCapabilitiesState
  highlight: boolean
  onRetry: () => Promise<void>
  onOpenSpeechSettings: () => void
  onDismiss: () => void
}) {
  const { locale, t } = useTranslation()
  const [retryState, setRetryState] = useState<'idle' | 'checking' | 'checked'>('idle')
  const copy = bannerCopy(capabilities, locale)
  if (!copy) return null

  const retry = async () => {
    setRetryState('checking')
    try {
      await onRetry()
      setRetryState('checked')
    } catch (error) {
      setRetryState('idle')
      throw error
    }
  }

  return (
    <div className={`speech-banner${highlight ? ' speech-banner-highlight' : ''}`}>
      <div className="speech-banner-body" role="status">
        <Text UNSAFE_className="speech-banner-title">{copy.title}</Text>
        <Text UNSAFE_className="speech-banner-desc">{copy.description}</Text>
        {retryState === 'checked' && (
          <Text UNSAFE_className="speech-banner-desc">{t('speech.banner.retryChecked')}</Text>
        )}
      </div>
      <div className="speech-banner-actions">
        <Button
          variant="secondary"
          isPending={retryState === 'checking'}
          onPress={() => observeRendererPromise(retry(), 'retry Speech connection')}
        >
          {t('speech.banner.retryConnection')}
        </Button>
        <Button variant="secondary" onPress={onOpenSpeechSettings}>
          {t('speech.banner.openSettings')}
        </Button>
      </div>
      <ActionButton
        isQuiet
        UNSAFE_className="speech-banner-close"
        aria-label={t('speech.banner.dismiss')}
        onPress={onDismiss}
      >
        <Close />
      </ActionButton>
    </div>
  )
}
