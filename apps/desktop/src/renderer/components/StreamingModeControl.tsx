import {
  ActionButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle'
import AudioWave from '@react-spectrum/s2/icons/AudioWave'
import Bell from '@react-spectrum/s2/icons/Bell'
import BellRotated from '@react-spectrum/s2/icons/BellRotated'
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown'
import Microphone from '@react-spectrum/s2/icons/Microphone'
import MicrophoneOff from '@react-spectrum/s2/icons/MicrophoneOff'
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff'

import type { ContinuousListeningSettings } from '../continuousListening/types'

type AttentionMode = ContinuousListeningSettings['mode']
type ListeningState = 'off' | 'starting' | 'on' | 'error'

const MODES: Array<{
  id: AttentionMode
  title: string
  subtitle: string
  Icon: typeof MicrophoneOff
}> = [
  { id: 'silent', title: 'Silent', subtitle: 'Не реагировать самостоятельно', Icon: VolumeOff },
  { id: 'passive', title: 'Passive', subtitle: 'Только на явное обращение', Icon: Bell },
  { id: 'active', title: 'Active', subtitle: 'На подходящие реплики', Icon: BellRotated },
  {
    id: 'streamer',
    title: 'Streamer',
    subtitle: 'Чаще замечать интересные реплики',
    Icon: AudioWave,
  },
]

const MODE_LABEL: Record<AttentionMode, string> = {
  silent: 'Silent',
  passive: 'Passive',
  active: 'Active',
  streamer: 'Streamer',
}

function stateLabel(state: ListeningState): string {
  switch (state) {
    case 'on':
      return 'Continuous Listening включён'
    case 'starting':
      return 'Запуск Continuous Listening'
    case 'error':
      return 'Ошибка Continuous Listening'
    default:
      return 'Continuous Listening выключен'
  }
}

function stateText(state: ListeningState): string {
  switch (state) {
    case 'on':
      return 'Слушает'
    case 'starting':
      return 'Запуск…'
    case 'error':
      return 'Ошибка'
    default:
      return 'Не слушает'
  }
}

function ListeningStatusIcon({ state }: { state: ListeningState }): React.JSX.Element {
  if (state === 'on') return <Microphone />
  if (state === 'error') return <AlertTriangle />
  if (state === 'starting') return <AudioWave />
  return <MicrophoneOff />
}

function ModeIcon({ mode, slot }: { mode: AttentionMode; slot?: string }): React.JSX.Element {
  const { Icon } = MODES.find((item) => item.id === mode) ?? MODES[0]
  return <Icon slot={slot} />
}

/**
 * Continuous Listening and attention policy share a compact header control but retain
 * separate actions. The listener toggle never changes the policy, and the policy
 * selector never opens the microphone gate.
 */
export function StreamingModeControl({
  mode,
  listeningState,
  onToggle,
  onModeChange,
}: {
  mode: AttentionMode
  listeningState: ListeningState
  onToggle: () => void
  onModeChange: (mode: AttentionMode) => void
}): React.JSX.Element {
  const status = stateLabel(listeningState)
  return (
    <div className={`attention-control streaming-${listeningState}`}>
      <TooltipTrigger delay={200}>
        <ActionButton
          aria-label={
            listeningState === 'on'
              ? 'Continuous Listening включён. Выключить.'
              : 'Continuous Listening выключен. Включить.'
          }
          aria-pressed={listeningState === 'on'}
          isDisabled={listeningState === 'starting'}
          onPress={onToggle}
          UNSAFE_className="listening-toggle"
        >
          <ListeningStatusIcon state={listeningState} />
          <Text>{stateText(listeningState)}</Text>
        </ActionButton>
        <Tooltip>{status}</Tooltip>
      </TooltipTrigger>
      <MenuTrigger>
        <ActionButton
          aria-label={`Режим внимания: ${MODE_LABEL[mode]}. Открыть выбор режима.`}
          UNSAFE_className={`attention-selector attention-mode-${mode}`}
        >
          <span slot="icon" className="control-selector-icons">
            <ModeIcon mode={mode} slot="presentation" />
            <ChevronDown slot="presentation" />
          </span>
        </ActionButton>
        <Menu
          aria-label="Режим внимания"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[mode]}
          onSelectionChange={(keys) => {
            if (keys === 'all') return
            const [key] = keys
            if (key) onModeChange(String(key) as AttentionMode)
          }}
        >
          {MODES.map(({ Icon, ...item }) => (
            <MenuItem key={item.id} id={item.id} textValue={item.title}>
              <Icon />
              <Text slot="label">{item.title}</Text>
              <Text slot="description">{item.subtitle}</Text>
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
    </div>
  )
}
