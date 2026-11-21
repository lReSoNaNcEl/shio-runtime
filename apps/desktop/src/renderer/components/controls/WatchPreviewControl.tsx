import {
  ActionButton,
  DialogTrigger,
  Heading,
  Popover,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop'
import { type RefCallback } from 'react'

import { useTranslation } from '../../localization/useTranslation'
import { type ContinuousListeningProjection } from '../../speech/continuous-listening/types'

export function WatchPreviewControl({
  sourceName,
  mountPreview,
  microphone,
}: {
  sourceName: string
  mountPreview: RefCallback<HTMLVideoElement>
  microphone: ContinuousListeningProjection['activeMicrophone']
}) {
  const { t } = useTranslation()
  return (
    <DialogTrigger>
      <ActionButton aria-label={t('watch.preview')}>
        <DeviceDesktop />
        <Text>{t('watch.preview')}</Text>
      </ActionButton>
      <Popover placement="bottom end" size="M">
        <div className="watch-preview-content">
          <Heading level={2}>{t('watch.preview')}</Heading>
          <video
            className="watch-preview-frame"
            aria-label={t('watch.liveFrame')}
            ref={mountPreview}
            autoPlay
            muted
            playsInline
          />
          <Text>{t('watch.initialSource', { name: sourceName })}</Text>
          {microphone && (
            <StatusLight variant="positive">
              {t('streaming.activeMicrophone', {
                name: microphone.label || t('streaming.unnamedDevice'),
              })}
            </StatusLight>
          )}
        </div>
      </Popover>
    </DialogTrigger>
  )
}
