import { Badge, Button, ProgressCircle, StatusLight, Text, ToggleButton } from '@react-spectrum/s2'
import AudioWave from '@react-spectrum/s2/icons/AudioWave'
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop'
import Microphone from '@react-spectrum/s2/icons/Microphone'
import MicrophoneOff from '@react-spectrum/s2/icons/MicrophoneOff'
import { type RefCallback } from 'react'

import { type WatchModelIssue } from '../../../shared/watchTogether'
import { type ControllerState } from '../../controller/contracts'
import { useTranslation } from '../../localization/useTranslation'
import { type ContinuousListeningProjection } from '../../speech/continuous-listening/types'
import { WatchPreviewControl } from './WatchPreviewControl'

function microphoneLabel(projection: ContinuousListeningProjection) {
  switch (projection.transport) {
    case 'ready':
      if (!projection.microphoneCaptured) return 'streaming.state.voiceOff'
      if (projection.activity === 'hearing-speech') return 'watch.micHearing'
      if (projection.activity === 'recognizing') return 'watch.micRecognizing'
      return 'watch.micListening'
    case 'starting':
      return 'watch.micStarting'
    case 'reconnecting':
      return 'watch.micReconnecting'
    case 'failed':
      return 'streaming.state.problem'
    case 'stopping':
      return 'streaming.state.stopping'
    default:
      return 'streaming.state.voiceOff'
  }
}

export function ListeningControl({
  isChoosing,
  projection,
  onChoose,
}: {
  isChoosing: boolean
  projection: ContinuousListeningProjection
  onChoose: () => void
}) {
  const { t } = useTranslation()
  return (
    <ToggleButton
      aria-label={t('watch.title')}
      aria-haspopup="dialog"
      isSelected={isChoosing}
      isDisabled={projection.transport === 'stopping'}
      onChange={onChoose}
    >
      <DeviceDesktop />
      <Text>{t('watch.title')}</Text>
    </ToggleButton>
  )
}

export function WatchSessionBar({
  phase,
  sourceName,
  mountPreview,
  projection,
  playbackGaps,
  voiceFeedback,
  modelIssue,
  onStop,
}: {
  phase: 'connecting' | 'live'
  sourceName: string
  mountPreview: RefCallback<HTMLVideoElement>
  projection: ContinuousListeningProjection
  playbackGaps: number
  voiceFeedback?: ControllerState['watchVoiceFeedback']
  modelIssue?: WatchModelIssue
  onStop: () => void
}) {
  const { t } = useTranslation()
  const live = phase === 'live'
  const micIssue = projection.transport === 'reconnecting' || projection.transport === 'failed'
  const MicIcon =
    micIssue || !projection.microphoneCaptured
      ? MicrophoneOff
      : projection.activity === 'idle'
        ? Microphone
        : AudioWave
  return (
    <section className="watch-session" data-phase={phase} aria-label={t('watch.title')}>
      <div className="watch-session-row">
        <div className="watch-session-summary">
          <div className="watch-session-source">
            <div className="watch-session-phase" role="status">
              <Badge variant={live ? 'positive' : 'informative'} fillStyle="subtle">
                {live ? (
                  <DeviceDesktop />
                ) : (
                  <ProgressCircle size="S" isIndeterminate aria-label={t('watch.connecting')} />
                )}
                <Text>{t(live ? 'watch.live' : 'watch.connecting')}</Text>
              </Badge>
            </div>
            <div className="watch-source-name" title={sourceName}>
              <Text>{sourceName}</Text>
            </div>
          </div>
          {live && (
            <div className="watch-session-mic" data-warning={micIssue || undefined} role="status">
              <MicIcon aria-hidden="true" />
              <Text>
                {t(
                  voiceFeedback &&
                    projection.transport === 'ready' &&
                    projection.activity === 'idle'
                    ? `watch.voiceFeedback.${voiceFeedback}`
                    : microphoneLabel(projection),
                )}
              </Text>
            </div>
          )}
        </div>
        <div className="watch-session-actions">
          {live && (
            <WatchPreviewControl
              sourceName={sourceName}
              mountPreview={mountPreview}
              microphone={projection.activeMicrophone}
            />
          )}
          <Button
            size="S"
            variant="negative"
            fillStyle="outline"
            aria-label={t(live ? 'watch.stop' : 'common.cancel')}
            onPress={onStop}
          >
            {t(live ? 'watch.stopShort' : 'common.cancel')}
          </Button>
        </div>
      </div>
      {(modelIssue || playbackGaps > 0 || !!projection.audioGapCount) && (
        <div className="watch-session-issues" role="status">
          {modelIssue && (
            <StatusLight size="S" variant="notice">
              {t(`watch.modelIssue.${modelIssue}`)}
            </StatusLight>
          )}
          {playbackGaps > 0 && (
            <StatusLight size="S" variant="notice">
              {t('watch.playbackGaps', { count: playbackGaps })}
            </StatusLight>
          )}
          {!!projection.audioGapCount && (
            <StatusLight size="S" variant="notice">
              {t('watch.microphoneGaps', { count: projection.audioGapCount })}
            </StatusLight>
          )}
        </div>
      )}
    </section>
  )
}
