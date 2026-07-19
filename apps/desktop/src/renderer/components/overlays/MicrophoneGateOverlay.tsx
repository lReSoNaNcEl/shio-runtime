import {
  ActionButton,
  Button,
  Content,
  Heading,
  InlineAlert,
  ProgressCircle,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone'
import MicrophoneOffIcon from '@react-spectrum/s2/icons/MicrophoneOff'
import RefreshIcon from '@react-spectrum/s2/icons/Refresh'
import type * as React from 'react'
import { useEffect, useRef } from 'react'

import type {
  MicrophoneFailureReason,
  MicrophoneGateOpenReason,
  MicrophoneGateState,
  MicrophoneIntent,
  MicrophoneOption,
} from '../../audio/microphoneGateTypes'
import type { LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'

interface Props {
  state: MicrophoneGateState
  onDeviceSelect: (deviceId: string) => void
  onRefresh: () => void
  onContinue: () => void
  onCancel: () => void
}

const FAILURE_KEY: Record<MicrophoneFailureReason, Parameters<LocalizationContextValue['t']>[0]> = {
  'permission-denied': 'microphone.gate.permissionDenied',
  'device-missing': 'microphone.gate.deviceMissing',
  'device-busy': 'microphone.gate.deviceBusy',
  'constraints-invalid': 'microphone.gate.constraintsInvalid',
  unknown: 'microphone.gate.unknown',
}

function headerCopy(
  intent: MicrophoneIntent,
  reason: MicrophoneGateOpenReason,
  t: LocalizationContextValue['t'],
): { title: string; description: string } {
  switch (reason) {
    case 'saved-device-missing':
    case 'saved-device-invalid':
      return {
        title: t('microphone.gate.savedMissing.title'),
        description: t('microphone.gate.savedMissing.description'),
      }
    case 'active-device-lost':
      return {
        title: t('microphone.gate.deviceLost.title'),
        description: t('microphone.gate.deviceLost.description'),
      }
    case 'runtime-start-failed':
      return {
        title: t('microphone.gate.startFailed.title'),
        description: t('microphone.gate.startFailed.description'),
      }
    default:
      return {
        title: t('microphone.gate.select.title'),
        description:
          intent.type === 'start-voice-input'
            ? t('microphone.gate.select.voice.description')
            : t('microphone.gate.select.streaming.description'),
      }
  }
}

function continueLabel(intent: MicrophoneIntent, t: LocalizationContextValue['t']): string {
  return intent.type === 'start-voice-input'
    ? t('microphone.gate.enable')
    : t('microphone.gate.startStreaming')
}

/** Split "Name (Detail)" into a primary caption and an optional secondary line. */
function splitLabel(label: string): { primary: string; secondary: string | null } {
  const match = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(label)
  if (match?.[1].trim()) return { primary: match[1].trim(), secondary: match[2].trim() }
  return { primary: label, secondary: null }
}

function DeviceRow({
  device,
  selected,
  validating,
  onSelect,
}: {
  device: MicrophoneOption
  selected: boolean
  validating: boolean
  onSelect: (deviceId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { primary, secondary } = splitLabel(device.label)
  return (
    // biome-ignore lint/a11y/useSemanticElements: custom-styled radio option in a radiogroup; a native <input type="radio"> cannot host the icon/label layout, so button+role="radio" with aria-checked is deliberate.
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`mic-device-row${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(device.deviceId)}
    >
      <span className="mic-device-radio" aria-hidden="true" />
      <span className="mic-device-icon">
        <MicrophoneIcon />
      </span>
      <span className="mic-device-text">
        <span className="mic-device-name">{primary}</span>
        {validating ? (
          <span className="mic-device-sub mic-device-checking">
            <ProgressCircle
              aria-label={t('microphone.gate.checkingAccess')}
              isIndeterminate
              size="S"
            />
            {t('microphone.gate.checkingAccess')}
          </span>
        ) : (
          secondary && <span className="mic-device-sub">{secondary}</span>
        )}
      </span>
    </button>
  )
}

export function MicrophoneGateOverlay({
  state,
  onDeviceSelect,
  onRefresh,
  onContinue,
  onCancel,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const cardRef = useRef<HTMLDivElement>(null)

  // Keep keyboard focus inside the card while the gate is open. Escape performs
  // a full cancel; a stray backdrop click does not close the gate.
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusable = (): HTMLElement[] =>
      Array.from(
        card.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
    ;(focusable()[0] ?? card).focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    card.addEventListener('keydown', onKeyDown)
    return () => {
      card.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [onCancel])

  if (state.status === 'closed') return null

  const { intent, reason } = state
  const { title, description } = headerCopy(intent, reason, t)
  const loading = state.status === 'loading-devices'
  const validating = state.status === 'validating'
  const devices = loading ? [] : state.devices
  const selectedDeviceId = loading ? null : state.selectedDeviceId
  const error = state.status === 'selecting' ? state.error : null
  const emptyDevices = !loading && devices.length === 0
  const canContinue =
    state.status === 'selecting' && Boolean(state.selectedDeviceId) && !emptyDevices
  const isDeviceLost = reason !== 'not-configured'

  return (
    <div className="mic-gate-backdrop" role="presentation">
      <div
        className="mic-gate-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={cardRef}
        tabIndex={-1}
      >
        <div className="mic-gate-header">
          <span className={`mic-gate-illus ${isDeviceLost ? 'is-warning' : ''}`}>
            {isDeviceLost ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
          </span>
          <Heading UNSAFE_className="mic-gate-title">{title}</Heading>
          <Content UNSAFE_className="mic-gate-desc">{description}</Content>
        </div>

        <div className="mic-gate-list-head">
          <span>{t('microphone.gate.availableDevices')}</span>
          {loading ? (
            <ProgressCircle aria-label={t('microphone.gate.refreshing')} isIndeterminate size="S" />
          ) : (
            <TooltipTrigger delay={200}>
              <ActionButton isQuiet aria-label={t('microphone.gate.refresh')} onPress={onRefresh}>
                <RefreshIcon />
              </ActionButton>
              <Tooltip>{t('microphone.gate.refreshShort')}</Tooltip>
            </TooltipTrigger>
          )}
        </div>

        {loading && (
          <div className="mic-gate-loading">
            <ProgressCircle aria-label={t('microphone.gate.loading')} isIndeterminate size="S" />
            <span>{t('microphone.gate.loading')}</span>
          </div>
        )}

        {emptyDevices && <p className="mic-gate-empty">{t('microphone.gate.empty')}</p>}

        {!loading && !emptyDevices && (
          <div
            className="mic-device-list"
            role="radiogroup"
            aria-label={t('microphone.gate.selection')}
          >
            {devices.map((device) => (
              <DeviceRow
                key={device.deviceId}
                device={device}
                selected={selectedDeviceId === device.deviceId}
                validating={validating && selectedDeviceId === device.deviceId}
                onSelect={onDeviceSelect}
              />
            ))}
          </div>
        )}

        {error && (
          <InlineAlert variant="negative" UNSAFE_className="mic-gate-alert">
            <Heading>{t('microphone.gate.accessFailed.title')}</Heading>
            <Content>{t(FAILURE_KEY[error])}</Content>
          </InlineAlert>
        )}

        <div className="mic-gate-actions">
          <Button variant="secondary" isDisabled={validating} onPress={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="accent"
            isDisabled={!canContinue}
            onPress={onContinue}
            UNSAFE_className="mic-gate-continue"
          >
            {validating && (
              <ProgressCircle
                aria-label={t('microphone.gate.checking')}
                isIndeterminate
                size="S"
                UNSAFE_className="mic-gate-btn-spinner"
              />
            )}
            <span>{validating ? t('common.checkingEllipsis') : continueLabel(intent, t)}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
