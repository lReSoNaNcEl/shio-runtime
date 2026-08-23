import {
  ActionButton,
  Button,
  Content,
  Dialog,
  DialogContainer,
  Footer,
  Heading,
  InlineAlert,
  ProgressCircle,
  Radio,
  RadioGroup,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone'
import MicrophoneOffIcon from '@react-spectrum/s2/icons/MicrophoneOff'
import RefreshIcon from '@react-spectrum/s2/icons/Refresh'

import {
  type MicrophoneFailureReason,
  type MicrophoneGateOpenReason,
  type MicrophoneGateState,
  type MicrophoneIntent,
  type MicrophoneOption,
} from '../../audio/microphoneGateTypes'
import { type LocalizationContextValue } from '../../localization/LocalizationProvider'
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

function DeviceRow({ device, validating }: { device: MicrophoneOption; validating: boolean }) {
  const { t } = useTranslation()
  const { primary, secondary } = splitLabel(device.label)
  return (
    <Radio value={device.deviceId} UNSAFE_className="mic-device-row">
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
    </Radio>
  )
}

export function MicrophoneGateOverlay({
  state,
  onDeviceSelect,
  onRefresh,
  onContinue,
  onCancel,
}: Props) {
  const { t } = useTranslation()

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
    <DialogContainer onDismiss={onCancel}>
      <Dialog size="M" aria-label={title} UNSAFE_className="mic-gate-card">
        <Heading UNSAFE_className="mic-gate-title">{title}</Heading>
        <Content>
          <div className="mic-gate-header">
            <span className={`mic-gate-illus ${isDeviceLost ? 'is-warning' : ''}`}>
              {isDeviceLost ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
            </span>
            <Text UNSAFE_className="mic-gate-desc">{description}</Text>
          </div>

          <div className="mic-gate-list-head">
            <span>{t('microphone.gate.availableDevices')}</span>
            {loading ? (
              <ProgressCircle
                aria-label={t('microphone.gate.refreshing')}
                isIndeterminate
                size="S"
              />
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

          {emptyDevices && (
            <Text UNSAFE_className="mic-gate-empty">{t('microphone.gate.empty')}</Text>
          )}

          {!loading && !emptyDevices && (
            <RadioGroup
              value={selectedDeviceId ?? ''}
              onChange={onDeviceSelect}
              isDisabled={validating}
              aria-label={t('microphone.gate.selection')}
              UNSAFE_className="mic-device-list"
            >
              {devices.map((device) => (
                <DeviceRow
                  key={device.deviceId}
                  device={device}
                  validating={validating && selectedDeviceId === device.deviceId}
                />
              ))}
            </RadioGroup>
          )}

          {error && (
            <InlineAlert variant="negative" UNSAFE_className="mic-gate-alert">
              <Heading>{t('microphone.gate.accessFailed.title')}</Heading>
              <Content>{t(FAILURE_KEY[error])}</Content>
            </InlineAlert>
          )}
        </Content>
        <Footer UNSAFE_className="mic-gate-actions">
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
        </Footer>
      </Dialog>
    </DialogContainer>
  )
}
