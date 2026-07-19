import { Badge, Button, ButtonGroup } from '@react-spectrum/s2'

import { type ScreenContextCaptureDescriptor } from '../../../shared/screen-context'
import { useTranslation } from '../../localization/useTranslation'

export function ScreenContextAttachment({
  capture,
  recapturing,
  imageOperationActive,
  onRecapture,
  onReplace,
  onRemove,
}: {
  capture: ScreenContextCaptureDescriptor
  recapturing: boolean
  imageOperationActive: boolean
  onRecapture: () => void
  onReplace: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const sourceLabel = t(`screenContext.source.${capture.sourceKind}`)
  const displayName =
    capture.sourceKind === 'clipboard'
      ? t('screenContext.source.clipboardName')
      : capture.sourceName
  return (
    <div className="screen-context-attachment">
      <img src={capture.previewDataUrl} alt="" />
      <div className="screen-context-attachment-copy">
        <div className="screen-context-attachment-heading">
          <strong title={displayName}>{displayName}</strong>
          <Badge
            size="S"
            variant={
              capture.sourceKind === 'screen' || capture.sourceKind === 'clipboard'
                ? 'informative'
                : 'gray'
            }
          >
            {sourceLabel}
          </Badge>
        </div>
        <span>
          {capture.width} × {capture.height}
        </span>
        <small>{t('screenContext.privacy')}</small>
      </div>
      <ButtonGroup size="S">
        {capture.canRecapture && (
          <Button
            variant="secondary"
            isPending={recapturing}
            isDisabled={imageOperationActive}
            onPress={onRecapture}
          >
            {recapturing
              ? t('screenContext.attachment.recapturing')
              : t('screenContext.attachment.recapture')}
          </Button>
        )}
        <Button variant="secondary" isDisabled={imageOperationActive} onPress={onReplace}>
          {t('screenContext.replace')}
        </Button>
        <Button variant="secondary" isDisabled={imageOperationActive} onPress={onRemove}>
          {t('screenContext.remove')}
        </Button>
      </ButtonGroup>
    </div>
  )
}
