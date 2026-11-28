import {
  ActionButton,
  Button,
  DialogTrigger,
  Heading,
  Popover,
  ProgressCircle,
  StatusLight,
  Switch,
  Text,
  ToggleButton,
} from '@react-spectrum/s2'
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle'
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop'
import Microphone from '@react-spectrum/s2/icons/Microphone'
import StopProcessing from '@react-spectrum/s2/icons/StopProcessing'
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff'
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo'
import { type RefCallback, useId } from 'react'

import { type WatchAudioStatus, type WatchModelIssue } from '../../../shared/watchTogether'
import { type ControllerState } from '../../controller/contracts'
import { useTranslation } from '../../localization/useTranslation'
import { type WatchMicrophoneStatus } from '../../runtime/WatchTogetherCapture'
import { type ContinuousListeningProjection } from '../../speech/continuous-listening/types'
import { WatchLevelMeter } from './WatchLevelMeter'
import { WatchPreviewControl } from './WatchPreviewControl'

function microphoneActivity(projection: ContinuousListeningProjection) {
  switch (projection.transport) {
    case 'ready':
      if (!projection.microphoneCaptured) return 'streaming.state.problem'
      if (projection.activity === 'hearing-speech') return 'watch.micHearing'
      if (projection.activity === 'recognizing') return 'watch.micRecognizing'
      return undefined
    case 'starting':
      return 'watch.micStarting'
    case 'reconnecting':
      return 'watch.micReconnecting'
    case 'failed':
      return 'streaming.state.problem'
    case 'stopping':
      return 'streaming.state.stopping'
    default:
      return undefined
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
  playbackAudio = 'unavailable',
  microphone,
  readPlaybackLevel,
  readMicrophoneLevel,
  onMicrophoneChange,
  voiceFeedback,
  modelIssue,
  onStop,
}: {
  phase: 'connecting' | 'live'
  sourceName: string
  mountPreview: RefCallback<HTMLVideoElement>
  projection: ContinuousListeningProjection
  playbackGaps: number
  playbackAudio?: WatchAudioStatus
  microphone: WatchMicrophoneStatus
  readPlaybackLevel: () => number
  readMicrophoneLevel: () => number
  onMicrophoneChange: (enabled: boolean) => void
  voiceFeedback?: ControllerState['watchVoiceFeedback']
  modelIssue?: WatchModelIssue
  onStop: () => void
}) {
  const { t } = useTranslation()
  const microphoneLabelId = useId()
  const live = phase === 'live'
  const microphoneRequested = microphone === 'on' || microphone === 'starting'
  const micIssue =
    microphone === 'failed' ||
    (microphone === 'on' &&
      (projection.transport === 'reconnecting' ||
        projection.transport === 'failed' ||
        (projection.transport === 'ready' && !projection.microphoneCaptured)))
  const hasPlaybackAudio = playbackAudio !== 'unavailable'
  const AudioIcon = hasPlaybackAudio ? VolumeTwo : VolumeOff
  const canMeterMicrophone =
    microphone === 'on' && projection.transport === 'ready' && projection.microphoneCaptured
  const voiceActivity =
    canMeterMicrophone && voiceFeedback && projection.activity === 'idle'
      ? (`watch.voiceFeedback.${voiceFeedback}` as const)
      : microphoneActivity(projection)
  const micLabel = (
    {
      off: 'watch.micOff',
      starting: 'watch.micStarting',
      on: voiceActivity ?? (canMeterMicrophone ? undefined : 'streaming.state.problem'),
      stopping: 'streaming.state.stopping',
      failed: 'watch.micUnavailable',
    } as const
  )[microphone]
  const warnings: string[] = []
  if (modelIssue) warnings.push(t(`watch.modelIssue.${modelIssue}`))
  if (playbackGaps > 0) warnings.push(t('watch.playbackGaps', { count: playbackGaps }))
  if (microphone === 'on' && projection.transport === 'failed' && projection.failure)
    warnings.push(
      t(
        projection.failure.domain === 'microphone' || projection.failure.domain === 'permission'
          ? 'streaming.failure.microphone'
          : 'streaming.failure.connection',
      ),
    )
  if (microphoneRequested && projection.audioGapCount)
    warnings.push(t('watch.microphoneGaps', { count: projection.audioGapCount }))
  const warningLabel = t('watch.warningCount', { count: warnings.length })

  return (
    <section className="watch-session" aria-label={t('watch.title')}>
      <div className="watch-session-card">
        <div className="watch-session-header">
          <div className="watch-session-source">
            <DeviceDesktop />
            <div className="watch-source-name" title={sourceName}>
              <Text>{sourceName}</Text>
            </div>
            <div className="watch-session-phase" role="status">
              {live ? (
                <StatusLight size="S" variant="positive">
                  {t('watch.live')}
                </StatusLight>
              ) : (
                <>
                  <ProgressCircle size="S" isIndeterminate aria-label={t('watch.connecting')} />
                  <Text>{t('watch.connecting')}</Text>
                </>
              )}
            </div>
          </div>
          <div className="watch-session-actions">
            {warnings.length > 0 && (
              <DialogTrigger>
                <ActionButton aria-label={warningLabel} size="S" isQuiet>
                  <AlertTriangle />
                  <Text>{warningLabel}</Text>
                </ActionButton>
                <Popover placement="bottom end" size="S">
                  <div className="watch-session-warning-details">
                    <Heading level={2}>{t('watch.warnings')}</Heading>
                    {warnings.map((warning) => (
                      <StatusLight key={warning} size="S" variant="notice">
                        {warning}
                      </StatusLight>
                    ))}
                  </div>
                </Popover>
              </DialogTrigger>
            )}
            {live && (
              <WatchPreviewControl
                sourceName={sourceName}
                mountPreview={mountPreview}
                microphone={microphoneRequested ? projection.activeMicrophone : undefined}
              />
            )}
            <Button
              size="S"
              variant={live ? 'negative' : 'secondary'}
              fillStyle={live ? 'fill' : 'outline'}
              aria-label={t(live ? 'watch.stop' : 'common.cancel')}
              onPress={onStop}
            >
              {live && <StopProcessing />}
              <Text>{t(live ? 'watch.stopShort' : 'common.cancel')}</Text>
            </Button>
          </div>
        </div>
        {live && (
          <div className="watch-session-signals">
            <div className="watch-session-channel">
              <div className="watch-session-channel-header">
                <AudioIcon />
                <Text>{t(`watch.audio.${playbackAudio}`)}</Text>
              </div>
              {hasPlaybackAudio && (
                <WatchLevelMeter
                  label={t('watch.audioLevel.playback')}
                  readLevel={readPlaybackLevel}
                  variant="informative"
                />
              )}
            </div>
            <div className="watch-session-channel">
              <div className="watch-session-channel-header">
                <Microphone />
                <Text id={microphoneLabelId}>{t('watch.microphoneControl')}</Text>
                <div className="watch-session-mic-switch">
                  <Switch
                    size="S"
                    aria-labelledby={microphoneLabelId}
                    isEmphasized
                    isSelected={microphoneRequested}
                    isDisabled={microphone === 'stopping'}
                    onChange={onMicrophoneChange}
                  />
                </div>
              </div>
              <div className="watch-session-channel-reading">
                {canMeterMicrophone && (
                  <div className="watch-session-meter">
                    <WatchLevelMeter
                      label={t('watch.audioLevel.microphone')}
                      readLevel={readMicrophoneLevel}
                      variant="positive"
                    />
                  </div>
                )}
                {micLabel && (
                  <div
                    role="status"
                    title={t(micLabel)}
                    className={
                      micIssue ? 'watch-session-input-issue' : 'watch-session-input-status'
                    }
                  >
                    <Text>{t(micLabel)}</Text>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="visually-hidden" role="status">
          {warnings.length > 0 && warningLabel}
        </div>
      </div>
    </section>
  )
}
