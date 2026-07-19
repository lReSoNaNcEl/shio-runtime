import { useTranslation } from '../../localization/useTranslation'

export function ScreenContextDropOverlay() {
  const { t } = useTranslation()
  return (
    <div className="screen-context-drop-overlay" role="status">
      <strong>{t('screenContext.drop.title')}</strong>
      <span>{t('screenContext.drop.description')}</span>
    </div>
  )
}
