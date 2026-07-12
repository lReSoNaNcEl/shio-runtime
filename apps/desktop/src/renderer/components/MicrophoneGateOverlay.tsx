import { useEffect, useRef } from 'react'
import {
  ActionButton,
  Button,
  Content,
  Heading,
  InlineAlert,
  ProgressCircle,
  Tooltip,
  TooltipTrigger
} from '@react-spectrum/s2'
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone'
import MicrophoneOffIcon from '@react-spectrum/s2/icons/MicrophoneOff'
import RefreshIcon from '@react-spectrum/s2/icons/Refresh'
import type {
  MicrophoneFailureReason,
  MicrophoneGateOpenReason,
  MicrophoneGateState,
  MicrophoneIntent,
  MicrophoneOption
} from '../audio/microphoneGateTypes'

interface Props {
  state: MicrophoneGateState
  onDeviceSelect: (deviceId: string) => void
  onRefresh: () => void
  onContinue: () => void
  onCancel: () => void
}

const FAILURE_MESSAGE: Record<MicrophoneFailureReason, string> = {
  'permission-denied': 'Нет доступа к микрофону. Разрешите его в настройках системы и попробуйте снова.',
  'device-missing': 'Микрофон не найден. Подключите устройство или выберите другое.',
  'device-busy': 'Устройство занято другим приложением. Закройте его и попробуйте снова.',
  'constraints-invalid': 'Выбранный микрофон больше недоступен. Выберите другое устройство.',
  unknown: 'Не удалось подключиться к микрофону. Проверьте устройство и попробуйте снова.'
}

function headerCopy(
  intent: MicrophoneIntent,
  reason: MicrophoneGateOpenReason
): { title: string; description: string } {
  switch (reason) {
    case 'saved-device-missing':
    case 'saved-device-invalid':
      return {
        title: 'Микрофон больше недоступен',
        description: 'Выбранное устройство больше недоступно. Подключите его снова или выберите другое.'
      }
    case 'active-device-lost':
      return {
        title: 'Подключение к микрофону потеряно',
        description: 'Подключение к текущему микрофону прервано. Подключите его снова или выберите другое.'
      }
    case 'runtime-start-failed':
      return {
        title: 'Не удалось включить микрофон',
        description: 'Не удалось получить доступ к устройству. Выберите другое или попробуйте снова.'
      }
    case 'not-configured':
    default:
      return {
        title: 'Выберите микрофон',
        description: intent.type === 'start-voice-input'
          ? 'Выберите доступный микрофон, чтобы Shio услышала вас.'
          : 'Shio должна слышать происходящее, чтобы реагировать во время стрима. Выберите доступный микрофон.'
      }
  }
}

function continueLabel(intent: MicrophoneIntent): string {
  return intent.type === 'start-voice-input' ? 'Включить микрофон' : 'Запустить стриминг'
}

/** Split "Name (Detail)" into a primary caption and an optional secondary line. */
function splitLabel(label: string): { primary: string; secondary: string | null } {
  const match = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(label)
  if (match && match[1].trim()) return { primary: match[1].trim(), secondary: match[2].trim() }
  return { primary: label, secondary: null }
}

function DeviceRow({
  device,
  selected,
  validating,
  onSelect
}: {
  device: MicrophoneOption
  selected: boolean
  validating: boolean
  onSelect: (deviceId: string) => void
}): React.JSX.Element {
  const { primary, secondary } = splitLabel(device.label)
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`mic-device-row${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(device.deviceId)}
    >
      <span className="mic-device-radio" aria-hidden="true" />
      <span className="mic-device-icon"><MicrophoneIcon /></span>
      <span className="mic-device-text">
        <span className="mic-device-name">{primary}</span>
        {validating
          ? <span className="mic-device-sub mic-device-checking"><ProgressCircle aria-label="Проверяем доступ" isIndeterminate size="S" />Проверяем доступ...</span>
          : secondary && <span className="mic-device-sub">{secondary}</span>}
      </span>
    </button>
  )
}

export function MicrophoneGateOverlay({ state, onDeviceSelect, onRefresh, onContinue, onCancel }: Props): React.JSX.Element | null {
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
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
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
  const { title, description } = headerCopy(intent, reason)
  const loading = state.status === 'loading-devices'
  const validating = state.status === 'validating'
  const devices = loading ? [] : state.devices
  const selectedDeviceId = loading ? null : state.selectedDeviceId
  const error = state.status === 'selecting' ? state.error : null
  const emptyDevices = !loading && devices.length === 0
  const canContinue = state.status === 'selecting' && Boolean(state.selectedDeviceId) && !emptyDevices
  const isDeviceLost = reason !== 'not-configured'

  return (
    <div className="mic-gate-backdrop" role="presentation">
      <div className="mic-gate-card" role="dialog" aria-modal="true" aria-label={title} ref={cardRef} tabIndex={-1}>
        <div className="mic-gate-header">
          <span className={`mic-gate-illus ${isDeviceLost ? 'is-warning' : ''}`}>
            {isDeviceLost ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
          </span>
          <Heading UNSAFE_className="mic-gate-title">{title}</Heading>
          <Content UNSAFE_className="mic-gate-desc">{description}</Content>
        </div>

        <div className="mic-gate-list-head">
          <span>Доступные устройства</span>
          {loading
            ? <ProgressCircle aria-label="Обновление списка" isIndeterminate size="S" />
            : <TooltipTrigger delay={200}>
                <ActionButton isQuiet aria-label="Обновить список устройств" onPress={onRefresh}>
                  <RefreshIcon />
                </ActionButton>
                <Tooltip>Обновить список</Tooltip>
              </TooltipTrigger>}
        </div>

        {loading && (
          <div className="mic-gate-loading">
            <ProgressCircle aria-label="Загрузка устройств" isIndeterminate size="S" />
            <span>Загрузка устройств...</span>
          </div>
        )}

        {emptyDevices && (
          <p className="mic-gate-empty">Микрофоны не найдены. Подключите устройство и обновите список.</p>
        )}

        {!loading && !emptyDevices && (
          <div className="mic-device-list" role="radiogroup" aria-label="Выбор микрофона">
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
            <Heading>Не удалось получить доступ к микрофону</Heading>
            <Content>{FAILURE_MESSAGE[error]}</Content>
          </InlineAlert>
        )}

        <div className="mic-gate-actions">
          <Button variant="secondary" isDisabled={validating} onPress={onCancel}>
            Отмена
          </Button>
          <Button variant="accent" isDisabled={!canContinue} onPress={onContinue} UNSAFE_className="mic-gate-continue">
            {validating && <ProgressCircle aria-label="Проверка микрофона" isIndeterminate size="S" UNSAFE_className="mic-gate-btn-spinner" />}
            <span>{validating ? 'Проверка...' : continueLabel(intent)}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
