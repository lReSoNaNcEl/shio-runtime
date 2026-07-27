import { ActionButton, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2'
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle'
import AudioWave from '@react-spectrum/s2/icons/AudioWave'
import Microphone from '@react-spectrum/s2/icons/Microphone'
import MicrophoneOff from '@react-spectrum/s2/icons/MicrophoneOff'

import { useTranslation } from '../../localization/useTranslation'
export type ListeningPresentationState = 'off' | 'starting' | 'on' | 'error'

function stateText(
  state: ListeningPresentationState,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (state) {
    case 'on':
      return t('streaming.state.listening')
    case 'starting':
      return t('streaming.state.startingShort')
    case 'error':
      return t('streaming.state.error')
    default:
      return t('streaming.state.notListening')
  }
}

function ListeningStatusIcon({ state }: { state: ListeningPresentationState }) {
  if (state === 'on') return <Microphone />
  if (state === 'error') return <AlertTriangle />
  if (state === 'starting') return <AudioWave />
  return <MicrophoneOff />
}

export function ListeningControl({
  listeningState,
  onToggle,
}: {
  listeningState: ListeningPresentationState
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const action =
    listeningState === 'on' ? t('streaming.toggle.disable') : t('streaming.toggle.enable')
  return (
    <TooltipTrigger delay={200}>
      <ActionButton
        aria-label={action}
        aria-pressed={listeningState === 'on'}
        isDisabled={listeningState === 'starting'}
        onPress={onToggle}
        UNSAFE_className={`listening-toggle streaming-${listeningState}`}
      >
        <ListeningStatusIcon state={listeningState} />
        <Text>{stateText(listeningState, t)}</Text>
      </ActionButton>
      <Tooltip>{action}</Tooltip>
    </TooltipTrigger>
  )
}
