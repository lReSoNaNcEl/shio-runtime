import { Text, ToggleButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2'
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle'
import AudioWave from '@react-spectrum/s2/icons/AudioWave'
import Microphone from '@react-spectrum/s2/icons/Microphone'
import MicrophoneOff from '@react-spectrum/s2/icons/MicrophoneOff'

import { useTranslation } from '../../localization/useTranslation'
import { type ContinuousListeningProjection } from '../../speech/continuous-listening/types'

function stateText(
  projection: ContinuousListeningProjection,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (projection.transport === 'ready') {
    if (projection.activity === 'hearing-speech') return t('streaming.state.hearing')
    if (projection.activity === 'recognizing') return t('streaming.state.recognizing')
    return t('streaming.state.waiting')
  }
  switch (projection.transport) {
    case 'starting':
      return t('streaming.state.startingShort')
    case 'reconnecting':
      return t('streaming.state.reconnecting')
    case 'failed':
      return t('streaming.state.problem')
    case 'stopping':
      return t('streaming.state.stopping')
    default:
      return t('streaming.state.voiceOff')
  }
}

function ListeningStatusIcon({ projection }: { projection: ContinuousListeningProjection }) {
  if (projection.transport === 'failed') return <AlertTriangle />
  if (
    projection.transport === 'starting' ||
    projection.transport === 'reconnecting' ||
    projection.activity !== 'idle'
  ) {
    return <AudioWave />
  }
  if (projection.transport === 'ready') return <Microphone />
  return <MicrophoneOff />
}

export function ListeningControl({
  projection,
  onToggle,
}: {
  projection: ContinuousListeningProjection
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const status = stateText(projection, t)
  const action = projection.desired ? t('streaming.toggle.disable') : t('streaming.toggle.enable')
  return (
    <TooltipTrigger delay={200}>
      <ToggleButton
        aria-label={`${t('streaming.control.label')}: ${status}. ${action}`}
        isSelected={projection.desired}
        isDisabled={projection.transport === 'stopping'}
        onChange={onToggle}
        UNSAFE_className={`listening-toggle streaming-${projection.transport} streaming-${projection.activity}`}
      >
        <ListeningStatusIcon projection={projection} />
        <Text>{t('streaming.control.label')}</Text>
      </ToggleButton>
      <Tooltip>{`${status} · ${action}`}</Tooltip>
    </TooltipTrigger>
  )
}
