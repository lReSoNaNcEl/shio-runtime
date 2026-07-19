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
import type * as React from 'react'

import type { LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'
import type { ContinuousListeningSettings } from '../../speech/continuous-listening/types'

type AttentionMode = ContinuousListeningSettings['mode']
type ListeningState = 'off' | 'starting' | 'on' | 'error'

const MODE_ICONS: Array<{
  id: AttentionMode
  Icon: typeof MicrophoneOff
}> = [
  { id: 'silent', Icon: VolumeOff },
  { id: 'passive', Icon: Bell },
  { id: 'active', Icon: BellRotated },
  { id: 'streamer', Icon: AudioWave },
]

function stateLabel(state: ListeningState, t: LocalizationContextValue['t']): string {
  switch (state) {
    case 'on':
      return t('streaming.state.on')
    case 'starting':
      return t('streaming.state.starting')
    case 'error':
      return t('streaming.state.error')
    default:
      return t('streaming.state.off')
  }
}

function stateText(state: ListeningState, t: LocalizationContextValue['t']): string {
  switch (state) {
    case 'on':
      return t('streaming.state.listening')
    case 'starting':
      return t('streaming.state.startingShort')
    case 'error':
      return t('common.error')
    default:
      return t('streaming.state.notListening')
  }
}

function ListeningStatusIcon({ state }: { state: ListeningState }): React.JSX.Element {
  if (state === 'on') return <Microphone />
  if (state === 'error') return <AlertTriangle />
  if (state === 'starting') return <AudioWave />
  return <MicrophoneOff />
}

function ModeIcon({ mode, slot }: { mode: AttentionMode; slot?: string }): React.JSX.Element {
  const { Icon } = MODE_ICONS.find((item) => item.id === mode) ?? MODE_ICONS[0]
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
  const { t } = useTranslation()
  const status = stateLabel(listeningState, t)
  const modes = MODE_ICONS.map((item) => ({
    ...item,
    title: t(`streaming.mode.${item.id}.title`),
    subtitle: t(`streaming.mode.${item.id}.subtitle`),
  }))
  return (
    <div className={`attention-control streaming-${listeningState}`}>
      <TooltipTrigger delay={200}>
        <ActionButton
          aria-label={
            listeningState === 'on' ? t('streaming.toggle.disable') : t('streaming.toggle.enable')
          }
          aria-pressed={listeningState === 'on'}
          isDisabled={listeningState === 'starting'}
          onPress={onToggle}
          UNSAFE_className="listening-toggle"
        >
          <ListeningStatusIcon state={listeningState} />
          <Text>{stateText(listeningState, t)}</Text>
        </ActionButton>
        <Tooltip>{status}</Tooltip>
      </TooltipTrigger>
      <MenuTrigger>
        <ActionButton
          aria-label={t('streaming.mode.open', {
            mode: t(`streaming.mode.${mode}.title`),
          })}
          UNSAFE_className={`attention-selector attention-mode-${mode}`}
        >
          <span slot="icon" className="control-selector-icons">
            <ModeIcon mode={mode} slot="presentation" />
            <ChevronDown slot="presentation" />
          </span>
        </ActionButton>
        <Menu
          aria-label={t('streaming.mode.label')}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[mode]}
          onSelectionChange={(keys) => {
            if (keys === 'all') return
            const [key] = keys
            if (key) onModeChange(String(key) as AttentionMode)
          }}
        >
          {modes.map(({ Icon, ...item }) => (
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
