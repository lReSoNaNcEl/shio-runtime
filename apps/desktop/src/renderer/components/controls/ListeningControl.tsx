import { Text, ToggleButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2'
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle'
import AudioWave from '@react-spectrum/s2/icons/AudioWave'
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop'
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
  watching,
}: {
  projection: ContinuousListeningProjection
  watching: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const status = stateText(projection, t)
  const label = t(watching ? 'watch.active' : 'watch.title')
  const action = t(watching ? 'watch.stop' : 'watch.title')
  const visibleLabel =
    watching && projection.activity !== 'idle'
      ? t(projection.activity === 'hearing-speech' ? 'watch.hearing' : 'watch.recognizing')
      : label
  return (
    <TooltipTrigger delay={200}>
      <ToggleButton
        aria-label={label}
        isSelected={watching}
        isDisabled={projection.transport === 'stopping'}
        onChange={onToggle}
        UNSAFE_className={`listening-toggle streaming-${projection.transport} streaming-${projection.activity}`}
      >
        {watching ? <ListeningStatusIcon projection={projection} /> : <DeviceDesktop />}
        <Text>{visibleLabel}</Text>
      </ToggleButton>
      <Tooltip>{`${status} · ${action}`}</Tooltip>
    </TooltipTrigger>
  )
}
