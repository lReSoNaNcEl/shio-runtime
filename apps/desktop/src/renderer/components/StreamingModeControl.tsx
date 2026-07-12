import { ActionButton, Menu, MenuItem, MenuTrigger, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2'
import AudioWave from '@react-spectrum/s2/icons/AudioWave'
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown'
import type { ContinuousListeningSettings } from '../continuousListening/types'

type AttentionMode = ContinuousListeningSettings['mode']
type ListeningState = 'off' | 'starting' | 'on' | 'error'

const MODES: Array<{ id: AttentionMode; title: string; subtitle: string }> = [
  { id: 'silent', title: 'Silent', subtitle: 'Не реагировать самостоятельно' },
  { id: 'passive', title: 'Passive', subtitle: 'Реагировать только на явное обращение' },
  { id: 'active', title: 'Active', subtitle: 'Реагировать на подходящие реплики' },
  { id: 'streamer', title: 'Streamer', subtitle: 'Чаще замечать интересные реплики' }
]

const MODE_LABEL: Record<AttentionMode, string> = {
  silent: 'Silent',
  passive: 'Passive',
  active: 'Active',
  streamer: 'Streamer'
}

function stateLabel(state: ListeningState): string {
  switch (state) {
    case 'on': return 'Стриминг-режим включён'
    case 'starting': return 'Запуск стриминг-режима'
    case 'error': return 'Ошибка стриминг-режима'
    default: return 'Стриминг-режим выключен'
  }
}

/**
 * Compound streaming control (split-button style): the main part toggles
 * Continuous Listening, the caret opens the attention-mode menu. Always rendered
 * regardless of listening state so the header never reflows on On/Off. The chosen
 * attention mode stays visible and remembered even while streaming is off.
 */
export function StreamingModeControl({ mode, listeningState, onToggle, onModeChange }: {
  mode: AttentionMode
  listeningState: ListeningState
  onToggle: () => void
  onModeChange: (mode: AttentionMode) => void
}): React.JSX.Element {
  const status = stateLabel(listeningState)
  return <div className={`streaming-split streaming-${listeningState}`}>
    <TooltipTrigger delay={200}>
      <ActionButton
        aria-label={`${status}. Режим внимания: ${MODE_LABEL[mode]}. Нажмите, чтобы переключить стриминг-режим.`}
        isDisabled={listeningState === 'starting'}
        onPress={onToggle}
        UNSAFE_className="streaming-main"
      >
        <AudioWave />
        <Text>{MODE_LABEL[mode]}</Text>
      </ActionButton>
      <Tooltip>{status} · Режим внимания: {MODE_LABEL[mode]}</Tooltip>
    </TooltipTrigger>
    <MenuTrigger>
      <ActionButton aria-label={`Режим внимания: ${MODE_LABEL[mode]}. Открыть выбор режима.`} UNSAFE_className="streaming-caret">
        <ChevronDown />
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
        {MODES.map((item) => (
          <MenuItem key={item.id} id={item.id}>
            <Text slot="label">{item.title}</Text>
            <Text slot="description">{item.subtitle}</Text>
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  </div>
}
