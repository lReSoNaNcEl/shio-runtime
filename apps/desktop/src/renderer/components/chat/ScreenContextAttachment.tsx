import { Button, ButtonGroup } from '@react-spectrum/s2'

import { type ScreenContextCaptureDescriptor } from '../../../shared/screen-context'
import { useTranslation } from '../../localization/useTranslation'

export function ScreenContextAttachment({
  capture,
  submitError,
  onReplace,
  onRemove,
}: {
  capture: ScreenContextCaptureDescriptor
  submitError: string | null
  onReplace: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="screen-context-attachment">
      <img src={capture.previewDataUrl} alt="" />
      <div className="screen-context-attachment-copy">
        <strong title={capture.sourceName}>{capture.sourceName}</strong>
        <span>
          {capture.width} × {capture.height}
        </span>
        <small>{t('screenContext.privacy')}</small>
      </div>
      <ButtonGroup size="S">
        <Button variant="secondary" onPress={onReplace}>
          {t('screenContext.replace')}
        </Button>
        <Button variant="secondary" onPress={onRemove}>
          {t('screenContext.remove')}
        </Button>
      </ButtonGroup>
      {submitError && (
        <span className="screen-context-attachment-error" role="alert">
          {submitError}
        </span>
      )}
    </div>
  )
}
